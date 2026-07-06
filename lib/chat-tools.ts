import { trading, data, crypto, beta, FEED, isCryptoSymbol } from "./alpaca";
import { listAlerts } from "./alerts";
import { computeTechnicals } from "./technicals";
import { displaySymbol, Position, Order, Snapshot, Bar } from "./types";
import type { LmTool } from "./llm";

/**
 * READ-ONLY tool surface for the chat copilot. There are deliberately no
 * order/position mutation tools here — the LLM cannot trade, cancel, or
 * close anything. Keep it that way until write access is an explicit,
 * separately-confirmed feature.
 */

export const CHAT_TOOLS: LmTool[] = [
  {
    type: "function",
    function: {
      name: "get_account",
      description: "Account equity, cash, buying power, and day P/L",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_positions",
      description: "All open positions with entry price, current value, and unrealized P/L",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_orders",
      description: "Recent orders",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["open", "closed"], description: "default open" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_quote",
      description: "Latest price and day change for a symbol (stock like AAPL or crypto pair like BTC/USD)",
      parameters: {
        type: "object",
        properties: { symbol: { type: "string" } },
        required: ["symbol"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bars",
      description: "Recent daily OHLCV bars for a symbol (up to 30 days)",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          days: { type: "number", description: "1-30, default 10" },
        },
        required: ["symbol"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_technicals",
      description:
        "Computed technical indicators for a symbol from ~1yr of daily bars: SMA 20/50/200, RSI-14, 30d realized volatility, 52-week high/low position, momentum over 5/20/60 days, volume trend. Use for trend/momentum questions instead of computing from raw bars.",
      parameters: {
        type: "object",
        properties: { symbol: { type: "string" } },
        required: ["symbol"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_news",
      description:
        "Recent market news headlines. Pass symbols to filter (e.g. 'NVDA' or 'BTCUSD'); omit for general market news.",
      parameters: {
        type: "object",
        properties: {
          symbols: { type: "string", description: "comma-separated, optional" },
          limit: { type: "number", description: "1-15, default 8" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_movers",
      description: "Today's top gaining and losing symbols (last trading session)",
      parameters: {
        type: "object",
        properties: {
          market: { type: "string", enum: ["stocks", "crypto"], description: "default stocks" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_most_actives",
      description: "Most actively traded stocks by volume (last trading session)",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_market_clock",
      description: "Whether the US stock market is open, and next open/close times",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "search_journal",
      description:
        "Semantic search over the user's saved research journal (past briefings, ticker research, alert notes). Use when the user asks what was previously found/said/researched about something.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_trade_log",
      description:
        "The user's recent fills with market-context snapshots captured at fill time (price, technicals). Use for reviewing past trades and spotting patterns.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "1-30, default 15" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_alerts",
      description: "Configured price alerts and whether they have triggered",
      parameters: { type: "object", properties: {} },
    },
  },
];

const num = (s: string | null | undefined) => (s == null ? null : parseFloat(s));

export async function runChatTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_account": {
      const a = await trading.get<Record<string, string>>("/account");
      const equity = num(a.equity)!;
      const lastEquity = num(a.last_equity)!;
      const gross =
        Math.abs(num(a.long_market_value) ?? 0) + Math.abs(num(a.short_market_value) ?? 0);
      return {
        status: a.status,
        equity,
        cash: num(a.cash),
        buying_power: num(a.buying_power),
        // margin picture: buying_power is intraday (equity × multiplier);
        // overnight holds must fit regt_buying_power; crypto/fractional are cash-only
        margin_multiplier: num(a.multiplier),
        overnight_regt_buying_power: num(a.regt_buying_power),
        non_marginable_buying_power: num(a.non_marginable_buying_power),
        account_leverage: equity ? +(gross / equity).toFixed(2) : null,
        day_pl: +(equity - lastEquity).toFixed(2),
        day_pl_pct: +(((equity - lastEquity) / lastEquity) * 100).toFixed(3),
      };
    }
    case "get_positions": {
      const ps = await trading.get<Position[]>("/positions");
      return ps.map((p) => ({
        symbol: displaySymbol(p),
        asset_class: p.asset_class,
        qty: num(p.qty),
        avg_entry: num(p.avg_entry_price),
        current_price: num(p.current_price),
        market_value: num(p.market_value),
        unrealized_pl: num(p.unrealized_pl),
        unrealized_pl_pct: +((num(p.unrealized_plpc) ?? 0) * 100).toFixed(3),
      }));
    }
    case "get_orders": {
      const status = args.status === "closed" ? "closed" : "open";
      const os = await trading.get<Order[]>(`/orders?status=${status}&limit=15&direction=desc`);
      return os.map((o) => ({
        symbol: o.symbol,
        side: o.side,
        qty: o.qty ?? (o.notional ? `$${o.notional}` : null),
        type: o.type,
        limit_price: num(o.limit_price),
        status: o.status,
        filled_avg_price: num(o.filled_avg_price),
        submitted_at: o.submitted_at,
      }));
    }
    case "get_quote": {
      const symbol = String(args.symbol ?? "").toUpperCase();
      if (!symbol) throw new Error("symbol required");
      let snap: Snapshot | undefined;
      if (isCryptoSymbol(symbol)) {
        const r = await crypto.get<{ snapshots: Record<string, Snapshot> }>(
          `/snapshots?symbols=${encodeURIComponent(symbol)}`
        );
        snap = r.snapshots?.[symbol];
      } else {
        const r = await data.get<Record<string, Snapshot>>(
          `/stocks/snapshots?symbols=${symbol}&feed=${FEED}`
        );
        snap = r[symbol];
      }
      if (!snap) return { error: `no data for ${symbol}` };
      const price = snap.latestTrade?.p ?? snap.dailyBar?.c ?? null;
      const prev = snap.prevDailyBar?.c ?? null;
      return {
        symbol,
        price,
        prev_close: prev,
        day_change_pct:
          price != null && prev ? +(((price - prev) / prev) * 100).toFixed(3) : null,
        day_high: snap.dailyBar?.h ?? null,
        day_low: snap.dailyBar?.l ?? null,
      };
    }
    case "get_bars": {
      const symbol = String(args.symbol ?? "").toUpperCase();
      if (!symbol) throw new Error("symbol required");
      const days = Math.min(Math.max(Number(args.days) || 10, 1), 30);
      const start = new Date(Date.now() - (days + 3) * 86_400_000).toISOString();
      let bars: Bar[];
      if (isCryptoSymbol(symbol)) {
        const r = await crypto.get<{ bars: Record<string, Bar[]> }>(
          `/bars?symbols=${encodeURIComponent(symbol)}&timeframe=1Day&start=${encodeURIComponent(start)}&limit=40`
        );
        bars = r.bars?.[symbol] ?? [];
      } else {
        const r = await data.get<{ bars: Bar[] }>(
          `/stocks/${symbol}/bars?timeframe=1Day&start=${encodeURIComponent(start)}&limit=40&adjustment=split&feed=${FEED}`
        );
        bars = r.bars ?? [];
      }
      return bars.slice(-days).map((b) => ({
        date: b.t.slice(0, 10),
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v,
      }));
    }
    case "get_technicals": {
      const symbol = String(args.symbol ?? "").toUpperCase();
      if (!symbol) throw new Error("symbol required");
      const start = new Date(Date.now() - 380 * 86_400_000).toISOString();
      let bars: Bar[];
      if (isCryptoSymbol(symbol)) {
        const r = await crypto.get<{ bars: Record<string, Bar[]> }>(
          `/bars?symbols=${encodeURIComponent(symbol)}&timeframe=1Day&start=${encodeURIComponent(start)}&limit=400`
        );
        bars = r.bars?.[symbol] ?? [];
      } else {
        const r = await data.get<{ bars: Bar[] }>(
          `/stocks/${symbol}/bars?timeframe=1Day&start=${encodeURIComponent(start)}&limit=400&adjustment=split&feed=${FEED}`
        );
        bars = r.bars ?? [];
      }
      return { symbol, ...computeTechnicals(bars) };
    }
    case "get_news": {
      const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 15);
      // news API wants crypto slashless (BTCUSD)
      const symbols = String(args.symbols ?? "")
        .toUpperCase()
        .replace(/\//g, "")
        .trim();
      const q = symbols ? `&symbols=${encodeURIComponent(symbols)}` : "";
      const r = await beta.get<{
        news: {
          headline: string;
          summary: string;
          source: string;
          created_at: string;
          symbols: string[];
        }[];
      }>(`/news?limit=${limit}&sort=desc${q}`);
      return (r.news ?? []).map((n) => ({
        headline: n.headline,
        summary: n.summary?.slice(0, 220) || undefined,
        source: n.source,
        at: n.created_at,
        symbols: n.symbols?.slice(0, 6),
      }));
    }
    case "get_movers": {
      const market = args.market === "crypto" ? "crypto" : "stocks";
      const r = await beta.get<{
        gainers: { symbol: string; percent_change: number; price: number }[];
        losers: { symbol: string; percent_change: number; price: number }[];
      }>(`/screener/${market}/movers?top=8`);
      return {
        note: "based on the most recent trading session",
        gainers: r.gainers,
        losers: r.losers,
      };
    }
    case "get_most_actives": {
      const r = await beta.get<{
        most_actives: { symbol: string; volume: number; trade_count: number }[];
      }>(`/screener/stocks/most-actives?by=volume&top=10`);
      return r.most_actives;
    }
    case "search_journal": {
      const query = String(args.query ?? "").trim();
      if (!query) throw new Error("query required");
      const { searchJournal } = await import("./embeddings");
      const hits = await searchJournal(query, 4);
      return hits.map((h) => ({
        date: h.date,
        title: h.title,
        excerpt: h.content.slice(0, 500),
        relevance: h.score,
      }));
    }
    case "get_trade_log": {
      const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 30);
      const { listTrades } = await import("./trade-log");
      return listTrades(limit).map((t) => ({
        at: new Date(t.ts).toISOString(),
        symbol: t.symbol,
        side: t.side,
        qty: t.qty,
        price: t.price,
        context: t.snapshot ?? "no snapshot (pre-journal fill)",
      }));
    }
    case "get_market_clock":
      return trading.get("/clock");
    case "get_alerts":
      return listAlerts().map((a) => ({
        symbol: a.symbol,
        condition: `${a.op} ${a.price}`,
        triggered: a.triggered ? `yes, at ${a.triggered.price}` : "no",
      }));
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
