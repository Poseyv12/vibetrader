export interface Account {
  id: string;
  account_number: string;
  status: string;
  equity: string;
  last_equity: string;
  cash: string;
  /** intraday buying power — equity × multiplier (4× when equity ≥ $25k) */
  buying_power: string;
  /** overnight (Reg-T) buying power — positions held past close must fit in this */
  regt_buying_power: string;
  /** cash-only buying power — crypto and fractional orders can't use margin */
  non_marginable_buying_power: string;
  multiplier: string;
  long_market_value: string;
  short_market_value: string;
  maintenance_margin: string;
  shorting_enabled: boolean;
  portfolio_value: string;
  daytrade_count: number;
}

export interface Position {
  symbol: string;
  asset_class: "us_equity" | "crypto";
  qty: string;
  side: "long" | "short";
  avg_entry_price: string;
  current_price: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  change_today: string;
}

export interface Order {
  id: string;
  symbol: string;
  qty: string | null;
  notional: string | null;
  filled_qty: string;
  side: "buy" | "sell";
  type: string;
  status: string;
  limit_price: string | null;
  filled_avg_price: string | null;
  submitted_at: string;
}

export interface NewsStory {
  id: number;
  headline: string;
  summary?: string;
  source: string;
  url?: string;
  created_at: string;
  /** crypto appears slashless here (BTCUSD) — the news API's convention */
  symbols: string[];
}

export interface Snapshot {
  latestTrade?: { p: number; t: string };
  latestQuote?: { bp: number; ap: number };
  dailyBar?: { o: number; h: number; l: number; c: number; v: number };
  prevDailyBar?: { c: number };
}

export interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Clock {
  is_open: boolean;
  next_open: string;
  next_close: string;
  timestamp: string;
}

export interface PortfolioHistory {
  timestamp: number[];
  equity: number[];
  profit_loss: number[];
  profit_loss_pct: number[];
}

/**
 * Positions report crypto as "BTCUSD"; data/order APIs want "BTC/USD".
 * Longer quote currencies first so BTCUSDT doesn't match USD.
 */
const QUOTE_CCYS = ["USDT", "USDC", "USD", "BTC"];
export function displaySymbol(p: { symbol: string; asset_class?: string }) {
  if (p.asset_class !== "crypto" || p.symbol.includes("/")) return p.symbol;
  for (const q of QUOTE_CCYS) {
    if (p.symbol.endsWith(q) && p.symbol.length > q.length) {
      return `${p.symbol.slice(0, -q.length)}/${q}`;
    }
  }
  return p.symbol;
}

/** last price + day change from a snapshot; a streamed price overrides the snapshot's */
export function snapPrice(s: Snapshot | undefined, live?: number) {
  const price = live ?? s?.latestTrade?.p ?? s?.dailyBar?.c ?? null;
  const prev = s?.prevDailyBar?.c ?? null;
  const chg = price != null && prev != null && prev !== 0 ? (price - prev) / prev : null;
  return { price, chg };
}

/**
 * Decimal places that keep small prices legible: 2 for $1+, otherwise enough
 * for ~3 significant figures (BONK at $0.0000123 → 8 decimals, not "$0.00").
 */
export const priceDigits = (n: number, base = 2) => {
  const a = Math.abs(n);
  if (a === 0 || a >= 1) return base;
  return Math.min(10, Math.max(base, 2 - Math.floor(Math.log10(a))));
};

export const fmtUsd = (v: number | string | null | undefined, digits?: number) => {
  if (v == null || v === "") return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (Number.isNaN(n)) return "—";
  const d = digits ?? priceDigits(n);
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
};

export const fmtPct = (v: number | string | null | undefined) => {
  if (v == null || v === "") return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (Number.isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
};

export const fmtNum = (v: number | string | null | undefined, digits?: number) => {
  if (v == null || v === "") return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (Number.isNaN(n)) return "—";
  const d = digits ?? priceDigits(n);
  return n.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
};
