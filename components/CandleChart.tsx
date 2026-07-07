"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { Bar, Snapshot, snapPrice, fmtNum, priceDigits } from "@/lib/types";
import { hexToRgba } from "@/lib/theme-client";
import { usePoll } from "@/hooks/usePoll";
import { useStream } from "@/hooks/useStream";
import { Panel } from "./Panel";

const RANGES = ["1D", "1W", "1M", "3M", "1Y"] as const;
type Range = (typeof RANGES)[number];

// validated defaults — dataviz six checks vs #0b0f0e; theme can override
const UP = "#26a69a";
const DOWN = "#ef5350";

function themeColors() {
  if (typeof window === "undefined") return { up: UP, down: DOWN };
  const css = getComputedStyle(document.documentElement);
  return {
    up: css.getPropertyValue("--up").trim() || UP,
    down: css.getPropertyValue("--down").trim() || DOWN,
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
  const [pendingAlert, setPendingAlert] = useState<{ price: number; x: number; y: number } | null>(
    null
  );
  const smaSeriesRef = useRef<Partial<Record<IndKey, ISeriesApi<"Line">>>>({});
  const barsRef = useRef<Bar[]>([]);
  const [themeTick, setThemeTick] = useState(0);

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
  }, []);

  const { data: snap } = usePoll<Record<string, Snapshot>>(
    `/api/snapshots?symbols=${encodeURIComponent(symbol)}`,
    10_000
  );
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

    // click a price level to stage an alert there
    chart.subscribeClick((param) => {
      if (!param.point) return;
      const price = candles.coordinateToPrice(param.point.y);
      if (price == null || price <= 0) return;
      setPendingAlert({ price, x: param.point.x, y: param.point.y });
    });

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
        </span>
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
