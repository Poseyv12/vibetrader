"use client";

import { useEffect, useMemo, useState } from "react";
import { StreamCtx, useStreamSource } from "@/hooks/useStream";
import { Header } from "@/components/Header";
import { TickerTape } from "@/components/TickerTape";
import { CandleChart } from "@/components/CandleChart";
import { AccountPanel } from "@/components/AccountPanel";
import { OrderTicket } from "@/components/OrderTicket";
import { Watchlist } from "@/components/Watchlist";
import { PositionsTable } from "@/components/PositionsTable";
import { OrdersPanel } from "@/components/OrdersPanel";
import { AlertsPanel } from "@/components/AlertsPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { ResearchPanel } from "@/components/ResearchPanel";
import { ToastHost } from "@/components/ToastHost";

const DEFAULT_WATCHLIST = [
  "SPY",
  "QQQ",
  "AAPL",
  "NVDA",
  "TSLA",
  "MSFT",
  "AMZN",
  "META",
  "BTC/USD",
  "ETH/USD",
];
// v2: crypto pairs added to defaults — new key so stale lists don't hide them
const LS_KEY = "vibetrader.watchlist.v2";

const RESEARCH_H_KEY = "vibetrader.researchHeight";

export default function Home() {
  const [symbol, setSymbol] = useState("SPY");
  const [watchlist, setWatchlist] = useState<string[]>(DEFAULT_WATCHLIST);
  const [hydrated, setHydrated] = useState(false);
  const [researchH, setResearchH] = useState(300);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const list = JSON.parse(saved);
        if (Array.isArray(list) && list.length) setWatchlist(list);
      }
    } catch {
      /* corrupted storage — keep defaults */
    }
    const h = parseInt(localStorage.getItem(RESEARCH_H_KEY) ?? "", 10);
    if (h >= 140) setResearchH(h);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(RESEARCH_H_KEY, String(researchH));
  }, [researchH, hydrated]);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    const startY = e.clientY;
    const startH = researchH;
    document.body.style.userSelect = "none";
    const move = (ev: PointerEvent) => {
      const h = Math.min(
        Math.max(startH + (startY - ev.clientY), 140),
        Math.round(window.innerHeight * 0.7)
      );
      setResearchH(h);
    };
    const up = () => {
      setDragging(false);
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  useEffect(() => {
    if (hydrated) localStorage.setItem(LS_KEY, JSON.stringify(watchlist));
  }, [watchlist, hydrated]);

  const streamSymbols = useMemo(
    () => Array.from(new Set([...watchlist, symbol])),
    [watchlist, symbol]
  );
  const stream = useStreamSource(hydrated ? streamSymbols : []);

  const addSymbol = (s: string) => {
    setWatchlist((w) => (w.includes(s) ? w : [...w, s]));
    setSymbol(s);
  };
  const removeSymbol = (s: string) =>
    setWatchlist((w) => (w.length > 1 ? w.filter((x) => x !== s) : w));

  return (
    <StreamCtx.Provider value={stream}>
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <ToastHost />
      <div className="reveal">
        <Header />
        <TickerTape symbols={watchlist} />
      </div>

      <main className="app-grid">
        <div className="col-main">
          <div
            className="reveal"
            style={{
              animationDelay: "80ms",
              display: "flex",
              flexDirection: "column",
              minHeight: 280,
              maxHeight: "62vh",
            }}
          >
            <CandleChart symbol={symbol} />
          </div>
          <div
            className={`vsplit ${dragging ? "dragging" : ""}`}
            onPointerDown={startResize}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize research panel"
          />
          <div
            className="reveal"
            style={{
              animationDelay: "140ms",
              display: "flex",
              flexDirection: "column",
              height: researchH,
              flexShrink: 0,
            }}
          >
            <ResearchPanel />
          </div>
          <div className="split reveal" style={{ animationDelay: "160ms" }}>
            <PositionsTable onSelect={setSymbol} />
            <OrdersPanel />
          </div>
        </div>

        <div className="col-side">
          <div className="reveal" style={{ animationDelay: "120ms" }}>
            <AccountPanel />
          </div>
          <div className="reveal" style={{ animationDelay: "200ms" }}>
            <OrderTicket symbol={symbol} />
          </div>
          <div className="reveal" style={{ animationDelay: "240ms" }}>
            <AlertsPanel symbol={symbol} />
          </div>
          <div className="reveal" style={{ animationDelay: "280ms", display: "flex", flex: 1, minHeight: 220 }}>
            <Watchlist
              symbols={watchlist}
              selected={symbol}
              onSelect={setSymbol}
              onAdd={addSymbol}
              onRemove={removeSymbol}
            />
          </div>
          <div className="reveal" style={{ animationDelay: "320ms", display: "flex", flexDirection: "column" }}>
            <ChatPanel symbol={symbol} />
          </div>
        </div>
      </main>

      <footer
        className="label"
        style={{ padding: "8px 14px", display: "flex", gap: 12, borderTop: "1px solid var(--line)" }}
      >
        <span>PAPER ACCOUNT — NOT REAL MONEY</span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: stream.connected ? "var(--up)" : "var(--amber)",
          }}
        >
          <span className={`led ${stream.connected ? "led-open" : "led-closed"}`} aria-hidden />
          {stream.connected ? "STREAM LIVE" : "POLLING (STREAM OFFLINE)"}
        </span>
        <span>data: alpaca iex feed</span>
      </footer>
    </div>
    </StreamCtx.Provider>
  );
}
