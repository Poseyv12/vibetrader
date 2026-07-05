"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  LineSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { Bar, PortfolioHistory } from "@/lib/types";
import { Panel } from "./Panel";

const RANGES = ["1M", "3M"] as const;
type Range = (typeof RANGES)[number];

const BENCH = "#7e948e"; // neutral reference — benchmark, not a competing series

/** % change from each series' first point — puts $25k equity and $744 SPY on one axis.
 *  Leading zero days (before the account existed) are dropped, not plotted as -100%. */
function normalize(points: { time: UTCTimestamp; value: number }[]) {
  const start = points.findIndex((p) => p.value !== 0);
  if (start < 0) return [];
  const live = points.slice(start);
  const base = live[0].value;
  return live.map((p) => ({ time: p.time, value: ((p.value - base) / base) * 100 }));
}

export function EquityChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const equityRef = useRef<ISeriesApi<"Line"> | null>(null);
  const benchRef = useRef<ISeriesApi<"Line"> | null>(null);
  const [range, setRange] = useState<Range>("1M");
  const [hover, setHover] = useState<{ eq: number | null; spy: number | null } | null>(null);
  const [last, setLast] = useState<{ eq: number | null; spy: number | null }>({ eq: null, spy: null });
  const equityColorRef = useRef("#26a69a");

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    equityColorRef.current =
      getComputedStyle(document.documentElement).getPropertyValue("--up").trim() || "#26a69a";

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#7e948e",
        fontFamily: "var(--font-plex-mono), monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: "#121b19" }, horzLines: { color: "#121b19" } },
      rightPriceScale: { borderColor: "#1c2926" },
      timeScale: { borderColor: "#1c2926" },
      crosshair: {
        vertLine: { color: "#465753", labelBackgroundColor: "#101716" },
        horzLine: { color: "#465753", labelBackgroundColor: "#101716" },
      },
      localization: { priceFormatter: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` },
    });

    const equity = chart.addSeries(LineSeries, {
      color: equityColorRef.current,
      lineWidth: 2,
      priceLineVisible: false,
    });
    const bench = chart.addSeries(LineSeries, {
      color: BENCH,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setHover(null);
        return;
      }
      const eq = (param.seriesData.get(equity) as { value?: number } | undefined)?.value ?? null;
      const spy = (param.seriesData.get(bench) as { value?: number } | undefined)?.value ?? null;
      setHover({ eq, spy });
    });

    const ro = new ResizeObserver(() =>
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight })
    );
    ro.observe(el);

    chartRef.current = chart;
    equityRef.current = equity;
    benchRef.current = bench;
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [histRes, spyRes] = await Promise.all([
        fetch(`/api/history?period=${range}`).then((r) => r.json()),
        fetch(`/api/bars?symbol=SPY&range=${range}`).then((r) => r.json()),
      ]);
      if (cancelled || !equityRef.current || !benchRef.current) return;

      const hist = histRes as PortfolioHistory;
      const eqPoints = (hist.timestamp ?? [])
        .map((t, i) => ({ time: t as UTCTimestamp, value: hist.equity?.[i] ?? 0 }))
        .filter((p) => p.value != null);
      const spyBars = (spyRes.bars ?? []) as Bar[];
      const spyPoints = spyBars.map((b) => ({
        time: Math.floor(Date.parse(b.t) / 1000) as UTCTimestamp,
        value: b.c,
      }));

      const eqNorm = normalize(eqPoints);
      const spyNorm = normalize(spyPoints);
      equityRef.current.setData(eqNorm);
      benchRef.current.setData(spyNorm);
      setLast({
        eq: eqNorm[eqNorm.length - 1]?.value ?? null,
        spy: spyNorm[spyNorm.length - 1]?.value ?? null,
      });
      chartRef.current?.timeScale().fitContent();
    })();
    return () => {
      cancelled = true;
    };
  }, [range]);

  const fmt = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
  const shown = hover ?? last;

  return (
    <Panel
      title="Equity vs SPY"
      right={
        <span style={{ display: "flex", gap: 2 }}>
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className="btn btn-ghost"
              style={{
                fontSize: 10,
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
      {/* legend — 2 series, so identity is never color-alone */}
      <div style={{ display: "flex", gap: 18, padding: "8px 12px 4px", fontSize: 11 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 2, background: "var(--up)", display: "inline-block" }} />
          <span style={{ color: "var(--ink-dim)" }}>YOUR EQUITY</span>
          <b style={{ color: "var(--ink)" }}>{fmt(shown.eq)}</b>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 2, background: BENCH, display: "inline-block" }} />
          <span style={{ color: "var(--ink-dim)" }}>SPY (BENCHMARK)</span>
          <b style={{ color: "var(--ink)" }}>{fmt(shown.spy)}</b>
        </span>
      </div>
      <div style={{ position: "relative", height: 260 }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      </div>
    </Panel>
  );
}
