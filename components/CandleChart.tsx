"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  LineStyle,
  createSeriesMarkers,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type UTCTimestamp,
} from "lightweight-charts";
import { Bar, Position, Snapshot, displaySymbol, snapPrice, fmtNum, priceDigits } from "@/lib/types";
import { hexToRgba } from "@/lib/theme-client";
import { usePoll } from "@/hooks/usePoll";
import { useStream } from "@/hooks/useStream";
import { Panel } from "./Panel";

const RANGES = ["1D", "1W", "1M", "3M", "1Y"] as const;
type Range = (typeof RANGES)[number];

// validated defaults — dataviz six checks vs #0b0f0e; theme can override
const UP = "#26a69a";
const DOWN = "#ef5350";

const ACCENT = "#22d3ee";
const AMBER = "#eda100";

function themeColors() {
  if (typeof window === "undefined")
    return { up: UP, down: DOWN, accent: ACCENT, amber: AMBER };
  const css = getComputedStyle(document.documentElement);
  return {
    up: css.getPropertyValue("--up").trim() || UP,
    down: css.getPropertyValue("--down").trim() || DOWN,
    accent: css.getPropertyValue("--accent").trim() || ACCENT,
    amber: css.getPropertyValue("--amber").trim() || AMBER,
  };
}

// secondary overlay lines — direct-labeled by their colored toggle buttons
const INDICATORS = [
  { key: "sma20", period: 20, color: "#64b5f6", label: "SMA20" },
  { key: "sma50", period: 50, color: "#eda100", label: "SMA50" },
  { key: "sma200", period: 200, color: "#b39ddb", label: "SMA200" },
] as const;
type IndKey = (typeof INDICATORS)[number]["key"];
const IND_LS_KEY = "vibetrader.indicators";

function smaData(bars: Bar[], period: number) {
  const out: { time: UTCTimestamp; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].c;
    if (i >= period) sum -= bars[i - period].c;
    if (i >= period - 1) {
      out.push({
        time: Math.floor(Date.parse(bars[i].t) / 1000) as UTCTimestamp,
        value: sum / period,
      });
    }
  }
  return out;
}

interface Ohlc {
  o: number;
  h: number;
  l: number;
  c: number;
  time: UTCTimestamp;
}

// client-safe mirror of lib/alerts.ts Alert (that module touches fs)
interface ChartAlert {
  id: string;
  symbol: string;
  op: "above" | "below";
  price: number;
  triggered?: { price: number; at: number };
}

// client-safe mirror of lib/trade-log.ts TradeLogEntry
interface ChartFill {
  id: string;
  ts: number;
  symbol: string; // trade updates may report crypto slashless (BTCUSD)
  side: string;
  qty: number;
  price: number;
  event: string;
}

const FILLS_KEY = "vibetrader.showFills";

/**
 * Drawings are rendered as LineSeries, so they pan/zoom with the chart for
 * free and stay hit-testable for click-to-delete. Endpoints snap to bar
 * times — arbitrary times would insert phantom columns into the shared time
 * scale and distort candle spacing. Drawings are kept per range because each
 * range uses a different bar resolution.
 */
const DRAW_TOOLS = [
  { kind: "trend", icon: "⌁", label: "TREND LINE", clicks: 2 },
  { kind: "ray", icon: "↗", label: "RAY", clicks: 2 },
  { kind: "hline", icon: "─", label: "H-LINE", clicks: 1 },
  { kind: "fib", icon: "≡", label: "FIB RETRACE", clicks: 2 },
] as const;
type DrawKind = (typeof DRAW_TOOLS)[number]["kind"];

interface Drawing {
  id: string;
  kind: DrawKind;
  range: Range;
  a: { time: number; price: number };
  b?: { time: number; price: number };
}
// key predates the extra tools — old entries are plain trendlines
const TL_KEY = "vibetrader.trendlines";

const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/**
 * Resolve a drawing to one or more polylines. Bars render uniformly by INDEX
 * (weekend gaps are collapsed), so ray extrapolation works in index space —
 * extending by timestamp would bend the line on screen.
 */
function drawingSegments(
  d: Drawing,
  times: number[]
): { pts: { time: number; value: number }[]; dashed?: boolean }[] {
  const { a, b } = d;
  if (d.kind === "hline") {
    const from = times[0] ?? a.time;
    const to = times[times.length - 1] ?? a.time;
    if (from === to) return [];
    return [{ pts: [{ time: from, value: a.price }, { time: to, value: a.price }] }];
  }
  if (!b) return [];
  if (d.kind === "fib") {
    const from = Math.min(a.time, b.time);
    const to = Math.max(a.time, b.time);
    return FIB_RATIOS.map((r) => ({
      dashed: r !== 0 && r !== 1,
      pts: [
        { time: from, value: b.price - (b.price - a.price) * r },
        { time: to, value: b.price - (b.price - a.price) * r },
      ],
    }));
  }
  const seg = [
    { time: a.time, value: a.price },
    { time: b.time, value: b.price },
  ];
  if (d.kind === "ray") {
    // extend from the first anchor through the second, in the drawn direction
    const ia = times.indexOf(a.time);
    const ib = times.indexOf(b.time);
    if (ia !== -1 && ib !== -1 && ib !== ia) {
      const end = ib > ia ? times.length - 1 : 0;
      if (Math.abs(end - ia) > Math.abs(ib - ia)) {
        const slope = (b.price - a.price) / (ib - ia);
        return [
          {
            pts: [
              { time: a.time, value: a.price },
              { time: times[end], value: a.price + slope * (end - ia) },
            ],
          },
        ];
      }
    }
  }
  return [{ pts: seg }];
}

export function CandleChart({ symbol }: { symbol: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [range, setRange] = useState<Range>("3M");
  const [hover, setHover] = useState<Ohlc | null>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [inds, setInds] = useState<Record<IndKey, boolean>>({
    sma20: true,
    sma50: true,
    sma200: false,
  });
  const [showFills, setShowFills] = useState(true);
  const [pendingAlert, setPendingAlert] = useState<{ price: number; x: number; y: number } | null>(
    null
  );
  const smaSeriesRef = useRef<Partial<Record<IndKey, ISeriesApi<"Line">>>>({});
  const barsRef = useRef<Bar[]>([]);
  const [themeTick, setThemeTick] = useState(0);
  const [tool, setTool] = useState<DrawKind | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState<{ time: number; price: number } | null>(null);
  const [drawings, setDrawings] = useState<Record<string, Drawing[]>>({});
  // series → drawing id, for click-to-delete hit-testing
  const drawSeriesRef = useRef<Map<ISeriesApi<"Line">, string>>(new Map());
  const drawingsLoadedRef = useRef(false);
  // bumped when bar data lands so rays/hlines re-extend to the newest bar
  const [barsTick, setBarsTick] = useState(0);

  useEffect(() => {
    const fn = () => setThemeTick((t) => t + 1);
    window.addEventListener("vt:theme", fn);
    return () => window.removeEventListener("vt:theme", fn);
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(IND_LS_KEY) ?? "");
      if (saved && typeof saved === "object") setInds((d) => ({ ...d, ...saved }));
    } catch {}
    if (localStorage.getItem(FILLS_KEY) === "0") setShowFills(false);
  }, []);

  useEffect(() => {
    localStorage.setItem(FILLS_KEY, showFills ? "1" : "0");
  }, [showFills]);

  const { data: snap } = usePoll<Record<string, Snapshot>>(
    `/api/snapshots?symbols=${encodeURIComponent(symbol)}`,
    10_000
  );
  const { data: positions } = usePoll<Position[]>("/api/positions", 10_000);
  const { data: alerts, refresh: refreshAlerts } = usePoll<ChartAlert[]>("/api/alerts", 30_000);
  const { data: trades } = usePoll<ChartFill[]>("/api/trades", 30_000);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const { prices: livePrices } = useStream();
  const livePrice = livePrices[symbol]?.p;
  const { price: last, chg } = snapPrice(snap?.[symbol], livePrice);
  // last candle bookkeeping for live streaming updates
  const lastBarRef = useRef<{
    time: UTCTimestamp;
    open: number;
    high: number;
    low: number;
    close: number;
  } | null>(null);
  const loadedSymbolRef = useRef<string | null>(null);

  // chart lifecycle — created once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#7e948e",
        fontFamily: "var(--font-plex-mono), monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#121b19" },
        horzLines: { color: "#121b19" },
      },
      rightPriceScale: { borderColor: "#1c2926" },
      timeScale: { borderColor: "#1c2926", timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: "#465753", labelBackgroundColor: "#101716" },
        horzLine: { color: "#465753", labelBackgroundColor: "#101716" },
      },
    });

    const { up: upC, down: downC } = themeColors();
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: upC,
      downColor: downC,
      borderUpColor: upC,
      borderDownColor: downC,
      wickUpColor: upC,
      wickDownColor: downC,
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    for (const ind of INDICATORS) {
      smaSeriesRef.current[ind.key] = chart.addSeries(LineSeries, {
        color: ind.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    }

    chart.subscribeCrosshairMove((param) => {
      const d = param.seriesData.get(candles) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      if (d && param.time) {
        setHover({ o: d.open, h: d.high, l: d.low, c: d.close, time: param.time as UTCTimestamp });
      } else {
        setHover(null);
      }
    });

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);

    chartRef.current = chart;
    candlesRef.current = candles;
    volumeRef.current = volume;
    markersRef.current = createSeriesMarkers(candles, []);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
    // themeTick: rebuild the chart with the new palette
  }, [themeTick]);

  // data load on symbol / range change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEmpty(false);
    setPendingAlert(null);
    setDraft(null); // a half-drawn line belongs to the previous symbol/range
    lastBarRef.current = null;
    loadedSymbolRef.current = null;

    (async () => {
      try {
        const res = await fetch(`/api/bars?symbol=${encodeURIComponent(symbol)}&range=${range}`);
        const body = await res.json();
        if (cancelled || !candlesRef.current || !volumeRef.current) return;

        const bars: Bar[] = body.bars ?? [];
        setEmpty(bars.length === 0);
        barsRef.current = bars;

        // axis precision that keeps sub-$1 symbols legible (BONK etc.)
        if (bars.length) {
          const precision = priceDigits(bars[bars.length - 1].c);
          candlesRef.current.applyOptions({
            priceFormat: {
              type: "price",
              precision,
              minMove: parseFloat((10 ** -precision).toFixed(precision)),
            },
          });
        }

        for (const ind of INDICATORS) {
          smaSeriesRef.current[ind.key]?.setData(smaData(bars, ind.period));
        }

        candlesRef.current.setData(
          bars.map((b) => ({
            time: Math.floor(Date.parse(b.t) / 1000) as UTCTimestamp,
            open: b.o,
            high: b.h,
            low: b.l,
            close: b.c,
          }))
        );
        const { up: upC, down: downC } = themeColors();
        const volUp = hexToRgba(upC, 0.35);
        const volDown = hexToRgba(downC, 0.35);
        volumeRef.current.setData(
          bars.map((b) => ({
            time: Math.floor(Date.parse(b.t) / 1000) as UTCTimestamp,
            value: b.v,
            color: b.c >= b.o ? volUp : volDown,
          }))
        );
        if (bars.length) {
          const lb = bars[bars.length - 1];
          lastBarRef.current = {
            time: Math.floor(Date.parse(lb.t) / 1000) as UTCTimestamp,
            open: lb.o,
            high: lb.h,
            low: lb.l,
            close: lb.c,
          };
          loadedSymbolRef.current = symbol;
        }
        setBarsTick((t) => t + 1);
        // dragging the price axis puts the scale into manual mode; re-enable
        // auto-scale so the new symbol's price range comes into view
        chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
        chartRef.current?.timeScale().fitContent();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [symbol, range, themeTick]);

  // indicator visibility follows the toggles (persisted)
  useEffect(() => {
    for (const ind of INDICATORS) {
      smaSeriesRef.current[ind.key]?.applyOptions({ visible: inds[ind.key] });
    }
    localStorage.setItem(IND_LS_KEY, JSON.stringify(inds));
  }, [inds]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(TL_KEY) ?? "{}");
      if (saved && typeof saved === "object") {
        // entries saved before the tool menu existed are plain trendlines
        const migrated: Record<string, Drawing[]> = {};
        for (const [sym, arr] of Object.entries(saved as Record<string, Drawing[]>)) {
          migrated[sym] = (arr ?? []).map((d) => ({ ...d, kind: d.kind ?? "trend" }));
        }
        setDrawings(migrated);
      }
    } catch {}
    drawingsLoadedRef.current = true;
  }, []);

  // chart clicks: an armed tool places/removes drawings, otherwise stage an
  // alert. Re-subscribed on state change so the handler sees current values.
  useEffect(() => {
    const chart = chartRef.current;
    const candles = candlesRef.current;
    if (!chart || !candles) return;

    const onClick = (param: MouseEventParams) => {
      if (!param.point) return;
      const price = candles.coordinateToPrice(param.point.y);
      if (price == null || price <= 0) return;

      if (!tool) {
        // click a price level to stage an alert there
        setPendingAlert({ price, x: param.point.x, y: param.point.y });
        return;
      }

      // clicking an existing drawing while a tool is armed removes it
      if (param.hoveredSeries) {
        const id = drawSeriesRef.current.get(param.hoveredSeries as ISeriesApi<"Line">);
        if (id) {
          setDrawings((t) => ({
            ...t,
            [symbol]: (t[symbol] ?? []).filter((d) => d.id !== id),
          }));
          return;
        }
      }

      if (param.time == null) return; // right margin — no bar to snap to
      const time = param.time as number;
      const add = (d: Omit<Drawing, "id" | "range">) => {
        setDrawings((t) => ({
          ...t,
          [symbol]: [...(t[symbol] ?? []), { id: crypto.randomUUID(), range, ...d }],
        }));
        setDraft(null);
        setTool(null);
      };

      if (tool === "hline") {
        add({ kind: "hline", a: { time, price } });
      } else if (!draft) {
        setDraft({ time, price });
      } else if (time !== draft.time) {
        // anchors need two distinct bars
        add({ kind: tool, a: draft, b: { time, price } });
      }
    };

    chart.subscribeClick(onClick);
    return () => chart.unsubscribeClick(onClick);
  }, [tool, draft, symbol, range, themeTick]);

  // drawing series follow state; persisted per symbol
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const s of drawSeriesRef.current.keys()) {
      try {
        chart.removeSeries(s);
      } catch {}
    }
    drawSeriesRef.current.clear();

    const times = barsRef.current.map((b) => Math.floor(Date.parse(b.t) / 1000));
    const { accent } = themeColors();
    for (const d of (drawings[symbol] ?? []).filter((d) => d.range === range)) {
      for (const seg of drawingSegments(d, times)) {
        if (seg.pts.length < 2) continue;
        const s = chart.addSeries(LineSeries, {
          color: accent,
          lineWidth: 1,
          lineStyle: seg.dashed ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        s.setData(
          seg.pts
            .slice()
            .sort((x, y) => x.time - y.time)
            .map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
        );
        drawSeriesRef.current.set(s, d.id);
      }
    }

    if (drawingsLoadedRef.current) {
      localStorage.setItem(TL_KEY, JSON.stringify(drawings));
    }
  }, [drawings, symbol, range, themeTick, barsTick]);

  // position entry + live alert levels as labeled price lines
  useEffect(() => {
    const candles = candlesRef.current;
    if (!candles) return;
    for (const pl of priceLinesRef.current) {
      try {
        candles.removePriceLine(pl);
      } catch {}
    }
    priceLinesRef.current = [];

    const { up, down, amber } = themeColors();
    const pos = (positions ?? []).find((p) => displaySymbol(p) === symbol);
    if (pos) {
      const entry = parseFloat(pos.avg_entry_price);
      const qty = parseFloat(pos.qty);
      if (entry > 0 && qty !== 0) {
        priceLinesRef.current.push(
          candles.createPriceLine({
            price: entry,
            color: parseFloat(pos.unrealized_pl) >= 0 ? up : down,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `${pos.side} ${fmtNum(Math.abs(qty))}`,
          })
        );
      }
    }
    for (const a of (alerts ?? []).filter((a) => a.symbol === symbol && !a.triggered)) {
      priceLinesRef.current.push(
        candles.createPriceLine({
          price: a.price,
          color: amber,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: `⚡ ${a.op}`,
        })
      );
    }
  }, [positions, alerts, symbol, themeTick]);

  // a triggered alert should drop off the chart right away
  useEffect(() => {
    const fn = () => refreshAlerts();
    window.addEventListener("vt:alert", fn);
    return () => window.removeEventListener("vt:alert", fn);
  }, [refreshAlerts]);

  // fills from the trade log as arrows on the candles they landed in
  useEffect(() => {
    const plugin = markersRef.current;
    if (!plugin) return;
    const times = barsRef.current.map((b) => Math.floor(Date.parse(b.t) / 1000));
    const slashless = symbol.replace("/", "");
    if (!showFills || !trades?.length || !times.length) {
      plugin.setMarkers([]);
      return;
    }
    const { up, down } = themeColors();
    const markers: SeriesMarker<Time>[] = [];
    for (const t of trades) {
      if (t.symbol !== symbol && t.symbol !== slashless) continue;
      const ts = Math.floor(t.ts / 1000);
      if (ts < times[0]) continue; // fill predates the loaded range
      // snap to the bar containing the fill (last bar time <= fill time)
      let lo = 0;
      let hi = times.length - 1;
      let idx = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= ts) {
          idx = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      const buy = t.side === "buy";
      markers.push({
        time: times[idx] as Time,
        position: buy ? "belowBar" : "aboveBar",
        shape: buy ? "arrowUp" : "arrowDown",
        color: buy ? up : down,
        text: `${buy ? "B" : "S"} ${t.qty}`,
        size: 1,
      });
    }
    plugin.setMarkers(markers.sort((a, b) => (a.time as number) - (b.time as number)));
  }, [trades, symbol, range, showFills, barsTick, themeTick]);

  // Escape backs out of drawing / closes the tool menu
  useEffect(() => {
    if (!tool && !menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTool(null);
        setDraft(null);
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, menuOpen]);

  const symbolDrawings = (drawings[symbol] ?? []).filter((d) => d.range === range);
  const clearDrawings = () =>
    setDrawings((t) => ({
      ...t,
      [symbol]: (t[symbol] ?? []).filter((d) => d.range !== range),
    }));
  const activeTool = DRAW_TOOLS.find((t) => t.kind === tool);

  const stageAlertOp: "above" | "below" =
    pendingAlert && pendingAlert.price >= (last ?? lastBarRef.current?.close ?? 0)
      ? "above"
      : "below";

  const stageAlert = async () => {
    if (!pendingAlert) return;
    const digits = priceDigits(pendingAlert.price);
    await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol,
        op: stageAlertOp,
        price: parseFloat(pendingAlert.price.toFixed(digits)),
      }),
    });
    setPendingAlert(null);
    window.dispatchEvent(new Event("vt:refresh"));
  };

  // tail refresh — new bars come from the server (it owns bar boundaries),
  // so fresh candles append without reloading the chart or disturbing the view
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.hidden || loadedSymbolRef.current !== symbol) return;
      const candles = candlesRef.current;
      const volume = volumeRef.current;
      const lastLoaded = lastBarRef.current;
      if (!candles || !volume || !lastLoaded) return;
      try {
        const res = await fetch(`/api/bars?symbol=${encodeURIComponent(symbol)}&range=${range}`);
        const body = await res.json();
        const fresh: Bar[] = body.bars ?? [];
        // bars from the last known candle onward: first replaces it, rest append
        const tail = fresh.filter(
          (b) => Math.floor(Date.parse(b.t) / 1000) >= lastLoaded.time
        );
        if (!tail.length || loadedSymbolRef.current !== symbol) return;

        const cutoff = Math.floor(Date.parse(tail[0].t) / 1000);
        barsRef.current = [
          ...barsRef.current.filter((b) => Math.floor(Date.parse(b.t) / 1000) < cutoff),
          ...tail,
        ];

        const { up: upC, down: downC } = themeColors();
        const volUp = hexToRgba(upC, 0.35);
        const volDown = hexToRgba(downC, 0.35);
        for (const b of tail) {
          const time = Math.floor(Date.parse(b.t) / 1000) as UTCTimestamp;
          candles.update({ time, open: b.o, high: b.h, low: b.l, close: b.c });
          volume.update({ time, value: b.v, color: b.c >= b.o ? volUp : volDown });
        }
        for (const ind of INDICATORS) {
          smaSeriesRef.current[ind.key]?.setData(smaData(barsRef.current, ind.period));
        }
        const lb = tail[tail.length - 1];
        lastBarRef.current = {
          time: Math.floor(Date.parse(lb.t) / 1000) as UTCTimestamp,
          open: lb.o,
          high: lb.h,
          low: lb.l,
          close: lb.c,
        };
        setBarsTick((t) => t + 1);
      } catch {
        /* transient fetch failure — next tick retries */
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [symbol, range, themeTick]);

  // stream ticks move the last candle in place
  useEffect(() => {
    const lb = lastBarRef.current;
    if (
      livePrice == null ||
      !lb ||
      loadedSymbolRef.current !== symbol ||
      !candlesRef.current
    )
      return;
    const updated = {
      ...lb,
      close: livePrice,
      high: Math.max(lb.high, livePrice),
      low: Math.min(lb.low, livePrice),
    };
    lastBarRef.current = updated;
    candlesRef.current.update(updated);
  }, [livePrice, symbol]);

  const up = (chg ?? 0) >= 0;

  return (
    <Panel
      title={`Chart // ${symbol}`}
      right={
        <span style={{ display: "flex", gap: 2 }}>
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className="btn btn-ghost"
              style={{
                fontSize: 10,
                letterSpacing: "0.1em",
                color: r === range ? "var(--accent)" : "var(--ink-faint)",
                borderBottom: r === range ? "1px solid var(--accent)" : "1px solid transparent",
              }}
            >
              {r}
            </button>
          ))}
        </span>
      }
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          padding: "10px 12px 6px",
          flexWrap: "wrap",
        }}
      >
        <span className={`display ${up ? "glow-up" : "glow-down"}`} style={{ fontSize: 26, fontWeight: 700 }}>
          {last != null ? fmtNum(last) : "—"}
        </span>
        {chg != null && (
          <span className={up ? "num-up" : "num-down"} style={{ fontSize: 13 }}>
            {up ? "▲" : "▼"} {Math.abs(chg * 100).toFixed(2)}% today
          </span>
        )}
        <span style={{ display: "flex", gap: 4, marginLeft: 6 }}>
          {INDICATORS.map((ind) => (
            <button
              key={ind.key}
              className="btn btn-ghost"
              onClick={() => setInds((s) => ({ ...s, [ind.key]: !s[ind.key] }))}
              aria-pressed={inds[ind.key]}
              style={{
                fontSize: 9,
                letterSpacing: "0.08em",
                padding: "2px 7px",
                color: inds[ind.key] ? ind.color : "var(--ink-faint)",
                border: "1px solid",
                borderColor: inds[ind.key] ? `${ind.color}66` : "var(--line)",
              }}
            >
              {ind.label}
            </button>
          ))}
          <button
            className="btn btn-ghost"
            onClick={() => setShowFills((v) => !v)}
            aria-pressed={showFills}
            style={{
              fontSize: 9,
              letterSpacing: "0.08em",
              padding: "2px 7px",
              color: showFills ? "var(--up)" : "var(--ink-faint)",
              border: "1px solid",
              borderColor: showFills ? "rgba(38,166,154,.4)" : "var(--line)",
            }}
          >
            ▲▼ FILLS
          </button>
          <span style={{ position: "relative" }}>
            <button
              className="btn btn-ghost"
              onClick={() => {
                if (tool) {
                  setTool(null);
                  setDraft(null);
                } else {
                  setMenuOpen((o) => !o);
                  setPendingAlert(null);
                }
              }}
              aria-pressed={tool != null}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              style={{
                fontSize: 9,
                letterSpacing: "0.08em",
                padding: "2px 7px",
                color: tool || menuOpen ? "var(--accent)" : "var(--ink-faint)",
                border: "1px solid",
                borderColor: tool || menuOpen ? "var(--accent)" : "var(--line)",
              }}
            >
              {activeTool ? `${activeTool.icon} ${activeTool.label}` : "✎ DRAW ▾"}
            </button>
            {menuOpen && !tool && (
              <span
                role="menu"
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  zIndex: 20,
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 130,
                  background: "var(--panel-raised)",
                  border: "1px solid var(--line-bright)",
                }}
              >
                {DRAW_TOOLS.map((t) => (
                  <button
                    key={t.kind}
                    role="menuitem"
                    className="btn btn-ghost"
                    onClick={() => {
                      setTool(t.kind);
                      setMenuOpen(false);
                    }}
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.08em",
                      padding: "6px 10px",
                      textAlign: "left",
                      color: "var(--ink-dim)",
                    }}
                  >
                    {t.icon} {t.label}
                  </button>
                ))}
              </span>
            )}
          </span>
          {symbolDrawings.length > 0 && (
            <button
              className="btn btn-ghost"
              onClick={clearDrawings}
              aria-label="Clear drawings"
              style={{
                fontSize: 9,
                letterSpacing: "0.08em",
                padding: "2px 7px",
                color: "var(--ink-faint)",
                border: "1px solid var(--line)",
              }}
            >
              ✕ {symbolDrawings.length}
            </button>
          )}
        </span>
        {tool && (
          <span className="label" style={{ color: "var(--accent)" }}>
            {activeTool?.clicks === 1
              ? "click the price level — esc cancels"
              : draft
                ? "click the second point — esc cancels"
                : "click the first point · click a drawing to remove it"}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {/* crosshair OHLC readout — the chart's tooltip layer */}
        <span style={{ fontSize: 11, color: "var(--ink-dim)", minHeight: 16 }}>
          {hover ? (
            <>
              O <b style={{ color: "var(--ink)" }}>{fmtNum(hover.o)}</b>{"  "}
              H <b style={{ color: "var(--ink)" }}>{fmtNum(hover.h)}</b>{"  "}
              L <b style={{ color: "var(--ink)" }}>{fmtNum(hover.l)}</b>{"  "}
              C <b className={hover.c >= hover.o ? "num-up" : "num-down"}>{fmtNum(hover.c)}</b>
            </>
          ) : (
            <span className="cursor-blink">▮</span>
          )}
        </span>
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
        {pendingAlert && (
          <div
            style={{
              position: "absolute",
              left: Math.min(pendingAlert.x + 12, 9999),
              top: Math.max(pendingAlert.y - 18, 4),
              zIndex: 10,
              background: "var(--panel-raised)",
              border: "1px solid var(--accent)",
              boxShadow: "0 0 20px rgba(34,211,238,0.2)",
              padding: "7px 10px",
              display: "flex",
              gap: 10,
              alignItems: "center",
              fontSize: 12,
              whiteSpace: "nowrap",
            }}
          >
            <span className="label" style={{ color: "var(--accent)" }}>
              ⚡ alert
            </span>
            <span className={stageAlertOp === "above" ? "num-up" : "num-down"}>
              {stageAlertOp === "above" ? "≥" : "≤"} {fmtNum(pendingAlert.price)}
            </span>
            <button className="btn" style={{ fontSize: 9, padding: "3px 10px" }} onClick={stageAlert}>
              SET
            </button>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 10, color: "var(--ink-faint)" }}
              onClick={() => setPendingAlert(null)}
              aria-label="Cancel alert"
            >
              ✕
            </button>
          </div>
        )}
        {(loading || empty) && (
          <div
            className="label"
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            {loading ? "loading bars…" : "no bar data for this range"}
          </div>
        )}
      </div>
    </Panel>
  );
}
