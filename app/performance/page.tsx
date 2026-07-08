"use client";

import { useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { usePoll } from "@/hooks/usePoll";
import { Panel } from "@/components/Panel";
import { EquityChart } from "@/components/EquityChart";
import { Account, fmtUsd, fmtNum } from "@/lib/types";

interface Note {
  id: string;
  date: string;
  title: string;
  content: string;
  created: number;
}

interface SymbolStats {
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

interface Perf {
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

interface Trade {
  id: string;
  ts: number;
  symbol: string;
  side: string;
  qty: number;
  price: number;
  snapshot?: { technicals?: { rsi14?: number; vs_sma20_pct?: number } };
}

function Tile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "up" | "down" }) {
  return (
    <div className="panel panel-corners" style={{ padding: "12px 14px" }}>
      <div className="corner-b" aria-hidden />
      <div className="label">{label}</div>
      <div
        className={`display ${tone === "up" ? "num-up" : tone === "down" ? "num-down" : ""}`}
        style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}
      >
        {value}
      </div>
    </div>
  );
}

const holdFmt = (mins: number | null) => {
  if (mins == null) return "—";
  if (mins < 60) return `${mins}m`;
  if (mins < 60 * 48) return `${(mins / 60).toFixed(1)}h`;
  return `${(mins / 1440).toFixed(1)}d`;
};

export default function PerformancePage() {
  const { data: perf } = usePoll<Perf>("/api/performance", 30_000);
  const { data: account } = usePoll<Account>("/api/account", 30_000);
  const { data: trades } = usePoll<Trade[]>("/api/trades", 20_000);
  const { data: notes, refresh: refreshNotes } = usePoll<Note[]>("/api/research", 60_000);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [freshReview, setFreshReview] = useState<Note | null>(null);

  const equity = account ? parseFloat(account.equity) : null;
  const dayPl = account ? parseFloat(account.equity) - parseFloat(account.last_equity) : null;
  const t = perf?.totals;

  // freshest review wins: one generated this visit, else the journal's latest
  const review =
    freshReview ??
    (notes ?? []).find((n) => n.title.startsWith("Trade review")) ??
    null;

  const runReview = async () => {
    setReviewing(true);
    setReviewError(null);
    try {
      const res = await fetch("/api/research/review", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "review failed");
      setFreshReview(body);
      refreshNotes();
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px 60px" }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 16 }}>
        <h1 className="display" style={{ fontSize: 18, fontWeight: 700, letterSpacing: "0.28em", margin: 0 }}>
          PERFORMANCE<span className="cursor-blink">_</span>
        </h1>
        {perf?.oldestFill && (
          <span className="label">
            since {new Date(perf.oldestFill).toLocaleDateString("en-US", { month: "short", day: "numeric" })} ·{" "}
            {t?.fills} fills
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button
          className="btn"
          onClick={runReview}
          disabled={reviewing}
          style={{
            fontSize: 10,
            padding: "4px 12px",
            color: reviewing ? "var(--amber)" : "var(--accent)",
            borderColor: reviewing ? "var(--amber)" : "var(--line-bright)",
          }}
        >
          {reviewing ? "REVIEWING…" : "◈ AI REVIEW"}
        </button>
        <Link href="/" className="label" style={{ color: "var(--accent)", textDecoration: "none" }}>
          ◂ back to terminal
        </Link>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 12 }}>
        <Tile label="Equity" value={fmtUsd(equity)} />
        <Tile label="Day P/L" value={dayPl != null ? fmtUsd(dayPl) : "—"} tone={(dayPl ?? 0) >= 0 ? "up" : "down"} />
        <Tile label="Realized P/L" value={t ? fmtUsd(t.realized) : "—"} tone={(t?.realized ?? 0) >= 0 ? "up" : "down"} />
        <Tile
          label="Win rate"
          value={t?.winRate != null ? `${t.winRate}%` : "—"}
          tone={t?.winRate != null ? (t.winRate >= 50 ? "up" : "down") : undefined}
        />
        <Tile label="Volume traded" value={t ? fmtUsd(t.volume, 0) : "—"} />
        <Tile label="Crypto fees" value={t?.cryptoFeesUsd != null ? fmtUsd(t.cryptoFeesUsd) : "—"} />
      </div>

      <div style={{ marginBottom: 12, display: "flex", flexDirection: "column" }}>
        <EquityChart />
      </div>

      {(review || reviewing || reviewError) && (
        <div style={{ marginBottom: 12, display: "flex", flexDirection: "column" }}>
          <Panel
            title="AI Trade Review"
            right={
              review ? (
                <span className="label">
                  {new Date(review.created).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}{" "}
                  · also in the research journal
                </span>
              ) : undefined
            }
          >
            {reviewError && (
              <div className="label" style={{ padding: "10px 14px", color: "var(--down)" }} role="alert">
                ✕ {reviewError}
              </div>
            )}
            {reviewing && !review && (
              <div className="label" style={{ padding: "10px 14px", color: "var(--amber)" }}>
                grading your fills against the market context captured at fill time…{" "}
                <span className="cursor-blink">▮</span>
              </div>
            )}
            {review && (
              <div className="chat-md" style={{ padding: "6px 16px 14px", fontSize: 12 }}>
                <ReactMarkdown>{review.content}</ReactMarkdown>
              </div>
            )}
          </Panel>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }} className="perf-split">
        <Panel title="By Symbol" right={<span className="label">{t?.roundTrips ?? 0} round-trips</span>}>
          <div style={{ overflow: "auto", minWidth: 0 }}>
            {!perf ? (
              <div className="label" style={{ padding: 14 }}>loading…</div>
            ) : perf.bySymbol.length === 0 ? (
              <div className="label" style={{ padding: 14 }}>no fills yet</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Sym</th>
                    <th>Trips</th>
                    <th>W/L</th>
                    <th>Realized</th>
                    <th>Avg hold</th>
                    <th>Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {perf.bySymbol.map((s) => (
                    <tr key={s.symbol}>
                      <td className="display" style={{ fontWeight: 600 }}>
                        {s.symbol}
                      </td>
                      <td>{s.roundTrips}</td>
                      <td>
                        <span className="num-up">{s.wins}</span>/<span className="num-down">{s.losses}</span>
                      </td>
                      <td className={s.realized >= 0 ? "num-up" : "num-down"}>
                        {s.realized >= 0 ? "+" : ""}
                        {fmtUsd(s.realized)}
                      </td>
                      <td style={{ color: "var(--ink-dim)" }}>{holdFmt(s.avgHoldMins)}</td>
                      <td style={{ color: "var(--ink-dim)" }}>{fmtUsd(s.volume, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Panel>

        <Panel title="Trade Journal" right={<span className="label">snapshots at fill time</span>}>
          <div style={{ overflow: "auto", minWidth: 0, maxHeight: 420 }}>
            {!trades || trades.length === 0 ? (
              <div className="label" style={{ padding: 14, lineHeight: 1.7 }}>
                no journaled fills yet — every fill from now on is logged here
                with the market context at that moment
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Side</th>
                    <th>Qty</th>
                    <th>Sym</th>
                    <th>Price</th>
                    <th>Context</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((tr) => {
                    const tech = tr.snapshot?.technicals;
                    return (
                      <tr key={tr.id}>
                        <td style={{ color: "var(--ink-dim)" }}>
                          {new Date(tr.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </td>
                        <td className={tr.side === "buy" ? "num-up" : "num-down"}>{tr.side.toUpperCase()}</td>
                        <td>{fmtNum(tr.qty, undefined)}</td>
                        <td className="display" style={{ fontWeight: 600 }}>{tr.symbol}</td>
                        <td>{fmtNum(tr.price)}</td>
                        <td style={{ color: "var(--ink-faint)", fontSize: 11 }}>
                          {tech?.rsi14 != null ? `RSI ${tech.rsi14}` : "—"}
                          {tech?.vs_sma20_pct != null ? ` · ${tech.vs_sma20_pct >= 0 ? "+" : ""}${tech.vs_sma20_pct}% vs SMA20` : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
