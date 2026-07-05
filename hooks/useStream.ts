"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

export interface LivePrice {
  p: number;
  t: number;
}

export interface StreamState {
  prices: Record<string, LivePrice>;
  connected: boolean;
}

export const StreamCtx = createContext<StreamState>({ prices: {}, connected: false });

/** Live prices + connection flag from the provider up the tree. */
export const useStream = () => useContext(StreamCtx);

/**
 * Opens the SSE relay for the given symbols. Trades/bars update a throttled
 * price map (400ms flush — BTC can tick many times a second); trade_update
 * events fire vt:refresh so account/positions/orders repoll instantly.
 * EventSource auto-reconnects; polling elsewhere is the fallback.
 */
export function useStreamSource(symbols: string[]): StreamState {
  const [connected, setConnected] = useState(false);
  const [prices, setPrices] = useState<Record<string, LivePrice>>({});
  const buffer = useRef<Record<string, LivePrice>>({});
  const dirty = useRef(false);
  const key = symbols.join(",");

  useEffect(() => {
    if (!key) return;
    const es = new EventSource(`/api/stream?symbols=${encodeURIComponent(key)}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.T === "t" && m.S) {
          buffer.current[m.S] = { p: m.p, t: Date.parse(m.t) };
          dirty.current = true;
        } else if (m.T === "b" && m.S) {
          buffer.current[m.S] = { p: m.c, t: Date.parse(m.t) };
          dirty.current = true;
        } else if (m.T === "trade_update") {
          window.dispatchEvent(new CustomEvent("vt:trade", { detail: m }));
          window.dispatchEvent(new Event("vt:refresh"));
        } else if (m.T === "alert") {
          window.dispatchEvent(new CustomEvent("vt:alert", { detail: m }));
        } else if (m.T === "research_note") {
          window.dispatchEvent(new CustomEvent("vt:research-note", { detail: m }));
          window.dispatchEvent(new Event("vt:refresh"));
        } else if (m.T === "news") {
          window.dispatchEvent(new CustomEvent("vt:news", { detail: m }));
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    const flush = setInterval(() => {
      if (dirty.current) {
        setPrices({ ...buffer.current });
        dirty.current = false;
      }
    }, 400);

    return () => {
      es.close();
      clearInterval(flush);
      setConnected(false);
    };
  }, [key]);

  return { prices, connected };
}
