import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

/**
 * Trade journal: every fill seen on the trade-updates stream is logged with
 * a market-context snapshot captured AT FILL TIME (quote + compact
 * technicals). That context can't be reconstructed later — it's what makes
 * "review my trades" answerable.
 */

export interface TradeLogEntry {
  id: string;
  ts: number;
  symbol: string;
  side: string;
  qty: number;
  price: number;
  event: string;
  snapshot?: unknown;
}

const FILE = path.join(process.cwd(), "data", "trades.json");
const g = globalThis as { __vtTrades?: TradeLogEntry[] };

function load(): TradeLogEntry[] {
  if (g.__vtTrades) return g.__vtTrades;
  try {
    g.__vtTrades = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    g.__vtTrades = [];
  }
  return g.__vtTrades!;
}

function save(entries: TradeLogEntry[]) {
  g.__vtTrades = entries;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(entries, null, 2));
}

export function listTrades(limit = 50): TradeLogEntry[] {
  return [...load()].sort((a, b) => b.ts - a.ts).slice(0, limit);
}

/** Record a fill; snapshot capture is async and best-effort. */
export async function recordFill(fill: {
  symbol?: string;
  side?: string;
  qty?: string;
  price?: string;
  event?: string;
}) {
  if (!fill.symbol || !fill.price) return;
  const entry: TradeLogEntry = {
    id: randomUUID(),
    ts: Date.now(),
    symbol: fill.symbol,
    side: fill.side ?? "?",
    qty: parseFloat(fill.qty ?? "0"),
    price: parseFloat(fill.price),
    event: fill.event ?? "fill",
  };

  try {
    // dynamic imports keep this module cheap and cycle-free
    const [{ runChatTool }, { compactTechnicals }] = await Promise.all([
      import("./chat-tools"),
      import("./technicals"),
    ]);
    const [quote, technicals] = await Promise.all([
      runChatTool("get_quote", { symbol: fill.symbol }).catch(() => null),
      runChatTool("get_technicals", { symbol: fill.symbol }).catch(() => null),
    ]);
    entry.snapshot = { quote, technicals: compactTechnicals(technicals) };
  } catch {
    /* snapshot is best-effort — the fill row still gets logged */
  }

  save([...load(), entry].slice(-500));
}
