import { Bar } from "./types";

/**
 * Deterministic technical indicators computed server-side from daily bars.
 * The local LLM interprets these numbers — it should never do the math
 * itself.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return r2(slice.reduce((a, b) => a + b, 0) / period);
}

function rsi14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  let gains = 0;
  let losses = 0;
  // Wilder's smoothing over the full series
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const alpha = i <= 14 ? 1 / 14 : 1 / 14;
    if (i <= 14) {
      if (d > 0) gains += d / 14;
      else losses -= d / 14;
    } else {
      gains = gains * (1 - alpha) + (d > 0 ? d : 0) * alpha;
      losses = losses * (1 - alpha) + (d < 0 ? -d : 0) * alpha;
    }
  }
  if (losses === 0) return 100;
  return r2(100 - 100 / (1 + gains / losses));
}

/** Slim technicals for small LLM context windows. */
export function compactTechnicals(t: unknown) {
  if (!t || typeof t !== "object") return t;
  const o = t as Record<string, unknown>;
  return {
    price: o.price,
    vs_sma20_pct: o.price_vs_sma20_pct,
    vs_sma50_pct: o.price_vs_sma50_pct,
    vs_sma200_pct: o.price_vs_sma200_pct,
    rsi14: o.rsi14,
    vol_30d_pct: o.realized_vol_30d_annualized_pct,
    chg_5d_pct: o.change_pct_5d,
    chg_20d_pct: o.change_pct_20d,
    high_52wk: o.high_52wk,
    low_52wk: o.low_52wk,
    pct_below_52wk_high: o.pct_below_52wk_high,
    error: o.error,
  };
}

export function computeTechnicals(bars: Bar[]) {
  if (bars.length < 20) return { error: "not enough bar history" };
  const closes = bars.map((b) => b.c);
  const price = closes[closes.length - 1];

  // annualized realized volatility from last 30 daily log returns
  const rets = closes
    .slice(-31)
    .map((c, i, arr) => (i === 0 ? null : Math.log(c / arr[i - 1])))
    .filter((x): x is number => x != null);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const volAnnualPct = r2(Math.sqrt(variance) * Math.sqrt(252) * 100);

  const highs = bars.map((b) => b.h);
  const lows = bars.map((b) => b.l);
  const hi52 = Math.max(...highs);
  const lo52 = Math.min(...lows);

  const vols = bars.map((b) => b.v);
  const avgVol20 = vols.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, vols.length);
  const avgVolAll = vols.reduce((a, b) => a + b, 0) / vols.length;

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const pctVs = (m: number | null) => (m ? r2(((price - m) / m) * 100) : null);

  const lookback = (days: number) =>
    closes.length > days ? r2(((price - closes[closes.length - 1 - days]) / closes[closes.length - 1 - days]) * 100) : null;

  return {
    price: r2(price),
    change_pct_5d: lookback(5),
    change_pct_20d: lookback(20),
    change_pct_60d: lookback(60),
    sma20,
    sma50,
    sma200,
    price_vs_sma20_pct: pctVs(sma20),
    price_vs_sma50_pct: pctVs(sma50),
    price_vs_sma200_pct: pctVs(sma200),
    rsi14: rsi14(closes),
    realized_vol_30d_annualized_pct: volAnnualPct,
    high_52wk: r2(hi52),
    low_52wk: r2(lo52),
    pct_below_52wk_high: r2(((hi52 - price) / hi52) * 100),
    pct_above_52wk_low: r2(((price - lo52) / lo52) * 100),
    volume_20d_vs_period_avg: r2(avgVol20 / avgVolAll),
    bars_analyzed: bars.length,
  };
}
