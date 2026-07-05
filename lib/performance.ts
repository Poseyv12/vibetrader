import { trading } from "./alpaca";

/**
 * Realized-performance stats computed FIFO from the account's actual fill
 * history (activities API — per-execution, so partial fills are exact).
 * Paper-account approximation: crypto fees are reported separately (CFEE),
 * not baked into per-fill prices.
 */

interface FillActivity {
  id: string;
  activity_type: "FILL";
  transaction_time: string;
  price: string;
  qty: string;
  side: "buy" | "sell" | "sell_short";
  symbol: string;
  cum_qty: string;
  leaves_qty: string;
}

export interface SymbolStats {
  symbol: string;
  fills: number;
  roundTrips: number;
  wins: number;
  losses: number;
  realized: number;
  avgHoldMins: number | null;
  openQty: number;
  volume: number;
}

export interface PerformanceStats {
  bySymbol: SymbolStats[];
  totals: {
    realized: number;
    roundTrips: number;
    wins: number;
    winRate: number | null;
    volume: number;
    fills: number;
    cryptoFeesUsd: number | null;
  };
  oldestFill: string | null;
}

async function fetchFills(): Promise<FillActivity[]> {
  const all: FillActivity[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 4; page++) {
    const qs = `page_size=100&direction=desc${pageToken ? `&page_token=${pageToken}` : ""}`;
    const batch = await trading.get<FillActivity[]>(`/account/activities/FILL?${qs}`);
    all.push(...batch);
    if (batch.length < 100) break;
    pageToken = batch[batch.length - 1].id;
  }
  return all.reverse(); // ascending time for FIFO
}

async function fetchCryptoFees(): Promise<number | null> {
  try {
    const fees = await trading.get<{ net_amount?: string }[]>(
      "/account/activities/CFEE?page_size=100&direction=desc"
    );
    if (!fees.length) return 0;
    return Math.abs(fees.reduce((a, f) => a + parseFloat(f.net_amount ?? "0"), 0));
  } catch {
    return null; // endpoint availability varies
  }
}

/** FIFO lot matching, symmetric for long and short round-trips. */
function computeSymbol(symbol: string, fills: FillActivity[]): SymbolStats {
  // signed lots: +qty = long lot, -qty = short lot
  const lots: { qty: number; price: number; time: number }[] = [];
  let realized = 0;
  let roundTrips = 0;
  let wins = 0;
  let losses = 0;
  let tripRealized = 0;
  let tripStart: number | null = null;
  let tripMaxAbs = 0;
  const holds: number[] = [];
  let volume = 0;

  const position = () => lots.reduce((a, l) => a + l.qty, 0);

  for (const f of fills) {
    const t = Date.parse(f.transaction_time);
    const price = parseFloat(f.price);
    let qty = parseFloat(f.qty) * (f.side === "buy" ? 1 : -1);
    volume += Math.abs(qty) * price;
    if (tripStart == null && position() === 0) tripStart = t;

    // consume opposing lots first
    while (qty !== 0 && lots.length && Math.sign(lots[0].qty) !== Math.sign(qty)) {
      const lot = lots[0];
      const matched = Math.min(Math.abs(qty), Math.abs(lot.qty));
      // long lot closed by sell: (sell - buy) * qty; short lot closed by buy: (short - cover) * qty
      const pnl =
        lot.qty > 0 ? (price - lot.price) * matched : (lot.price - price) * matched;
      realized += pnl;
      tripRealized += pnl;
      lot.qty -= Math.sign(lot.qty) * matched;
      qty -= Math.sign(qty) * matched;
      if (Math.abs(lot.qty) < 1e-12) lots.shift();
    }
    if (qty !== 0) lots.push({ qty, price, time: t });

    const pos = position();
    tripMaxAbs = Math.max(tripMaxAbs, Math.abs(pos));

    // flat again → a round-trip completed. Crypto fees are charged in the
    // base asset (not visible in FILL activities), so "flat" tolerates
    // residual dust up to 0.6% of the trip's peak position.
    const dust = Math.max(1e-9, tripMaxAbs * 0.006);
    if (Math.abs(pos) <= dust && tripStart != null && tripRealized !== 0) {
      roundTrips++;
      if (tripRealized > 0) wins++;
      else losses++;
      holds.push((t - tripStart) / 60_000);
      lots.length = 0; // drop fee dust so it can't pollute the next trip
      tripRealized = 0;
      tripStart = null;
      tripMaxAbs = 0;
    }
  }

  return {
    symbol,
    fills: fills.length,
    roundTrips,
    wins,
    losses,
    realized: Math.round(realized * 100) / 100,
    avgHoldMins: holds.length
      ? Math.round(holds.reduce((a, b) => a + b, 0) / holds.length)
      : null,
    openQty: Math.round(position() * 1e9) / 1e9,
    volume: Math.round(volume * 100) / 100,
  };
}

export async function computePerformance(): Promise<PerformanceStats> {
  const [fills, cryptoFeesUsd] = await Promise.all([fetchFills(), fetchCryptoFees()]);

  const grouped = new Map<string, FillActivity[]>();
  for (const f of fills) {
    if (!grouped.has(f.symbol)) grouped.set(f.symbol, []);
    grouped.get(f.symbol)!.push(f);
  }

  const bySymbol = [...grouped.entries()]
    .map(([sym, fs]) => computeSymbol(sym, fs))
    .sort((a, b) => b.realized - a.realized);

  const realized = bySymbol.reduce((a, s) => a + s.realized, 0);
  const roundTrips = bySymbol.reduce((a, s) => a + s.roundTrips, 0);
  const wins = bySymbol.reduce((a, s) => a + s.wins, 0);

  return {
    bySymbol,
    totals: {
      realized: Math.round(realized * 100) / 100,
      roundTrips,
      wins,
      winRate: roundTrips ? Math.round((wins / roundTrips) * 1000) / 10 : null,
      volume: Math.round(bySymbol.reduce((a, s) => a + s.volume, 0) * 100) / 100,
      fills: fills.length,
      cryptoFeesUsd,
    },
    oldestFill: fills[0]?.transaction_time ?? null,
  };
}
