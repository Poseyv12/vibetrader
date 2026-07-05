import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

/**
 * Price alert store. Persisted to data/alerts.json so alerts survive server
 * restarts; cached on globalThis so the stream hub's per-tick checks never
 * touch disk unless something changed.
 */

export interface Alert {
  id: string;
  symbol: string; // stream format: AAPL or BTC/USD
  op: "above" | "below";
  price: number;
  created: number;
  triggered?: { price: number; at: number };
}

const FILE = path.join(process.cwd(), "data", "alerts.json");
const g = globalThis as { __vtAlerts?: Alert[] };

function load(): Alert[] {
  if (g.__vtAlerts) return g.__vtAlerts;
  try {
    g.__vtAlerts = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    g.__vtAlerts = [];
  }
  return g.__vtAlerts!;
}

function save(alerts: Alert[]) {
  g.__vtAlerts = alerts;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(alerts, null, 2));
}

export function listAlerts(): Alert[] {
  return load();
}

export function addAlert(symbol: string, op: "above" | "below", price: number): Alert {
  const alert: Alert = {
    id: randomUUID(),
    symbol: symbol.toUpperCase(),
    op,
    price,
    created: Date.now(),
  };
  save([...load(), alert]);
  return alert;
}

export function deleteAlert(id: string): boolean {
  const alerts = load();
  const next = alerts.filter((a) => a.id !== id);
  if (next.length === alerts.length) return false;
  save(next);
  return true;
}

/** Evaluate a tick; returns alerts that just fired (and persists the flag). */
export function checkAlerts(symbol: string, price: number): Alert[] {
  const alerts = load();
  const fired = alerts.filter(
    (a) =>
      !a.triggered &&
      a.symbol === symbol &&
      (a.op === "above" ? price >= a.price : price <= a.price)
  );
  if (fired.length) {
    const now = Date.now();
    fired.forEach((a) => (a.triggered = { price, at: now }));
    save(alerts);
  }
  return fired;
}

/** Symbols with live (untriggered) alerts — the hub subscribes to these. */
export function alertSymbols(): string[] {
  return [...new Set(load().filter((a) => !a.triggered).map((a) => a.symbol))];
}
