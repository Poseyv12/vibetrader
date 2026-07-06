"use client";

import { useEffect, useState } from "react";
import { usePoll } from "@/hooks/usePoll";
import { NewsStory } from "@/lib/types";
import { Panel } from "./Panel";

/** A story from the live stream (`vt:news`) — already triaged by the watchdog. */
interface LiveNews {
  headline: string;
  symbols?: string[];
  source?: string;
  sentiment?: "bullish" | "bearish" | "neutral";
  impact?: "low" | "medium" | "high";
  note?: string;
  at: number;
}

const SENTIMENT: Record<string, { mark: string; color: string }> = {
  bullish: { mark: "▲", color: "var(--up)" },
  bearish: { mark: "▼", color: "var(--down)" },
  neutral: { mark: "◆", color: "var(--ink-dim)" },
};

const when = (d: Date) =>
  d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function NewsPanel({ symbol }: { symbol: string }) {
  const [scope, setScope] = useState<"symbol" | "all">("symbol");
  const [live, setLive] = useState<LiveNews[]>([]);

  const slashless = symbol.replace("/", "").toUpperCase();
  const url =
    scope === "symbol"
      ? `/api/news?symbols=${encodeURIComponent(slashless)}&limit=30`
      : "/api/news?limit=30";
  const { data: stories, error } = usePoll<NewsStory[]>(url, 60_000);

  // watchdog-triaged stories arrive over SSE regardless of which tab is open
  useEffect(() => {
    const onNews = (e: Event) => {
      const d = (e as CustomEvent).detail as Omit<LiveNews, "at">;
      if (!d?.headline) return;
      setLive((l) => [{ ...d, at: Date.now() }, ...l].slice(0, 20));
    };
    window.addEventListener("vt:news", onNews);
    return () => window.removeEventListener("vt:news", onNews);
  }, []);

  const liveShown = live.filter(
    (n) =>
      scope === "all" ||
      (n.symbols ?? []).some((s) => s.toUpperCase() === slashless)
  );
  // don't repeat a streamed story when the poll catches up to it
  const seen = new Set(liveShown.map((n) => n.headline));
  const rows = (stories ?? []).filter((s) => !seen.has(s.headline));

  const chips = (syms: string[] | undefined) =>
    (syms ?? []).slice(0, 5).map((t) => (
      <span
        key={t}
        style={{ color: t.toUpperCase() === slashless ? "var(--accent)" : "var(--ink-faint)" }}
      >
        {t}
      </span>
    ));

  return (
    <Panel
      title={`News // ${scope === "symbol" ? symbol : "market"}`}
      right={
        <div className="seg" role="radiogroup" aria-label="News scope">
          <button
            className={scope === "symbol" ? "active" : ""}
            style={{ padding: "2px 10px", fontSize: 10 }}
            onClick={() => setScope("symbol")}
          >
            {symbol}
          </button>
          <button
            className={scope === "all" ? "active" : ""}
            style={{ padding: "2px 10px", fontSize: 10 }}
            onClick={() => setScope("all")}
          >
            ALL
          </button>
        </div>
      }
    >
      <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
        {liveShown.map((n, i) => {
          const s = SENTIMENT[n.sentiment ?? "neutral"];
          return (
            <div
              key={`${n.at}-${i}`}
              style={{
                padding: "8px 12px",
                borderBottom: "1px solid rgba(28,41,38,.5)",
                display: "flex",
                gap: 10,
                alignItems: "baseline",
                background: "var(--panel-raised)",
              }}
            >
              <span className="label" style={{ flexShrink: 0, width: 52 }}>
                {when(new Date(n.at))}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12 }}>
                  <span style={{ color: s.color, marginRight: 6 }}>{s.mark}</span>
                  {n.headline}
                </span>
                {n.note && (
                  <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 3 }}>
                    {n.note}
                  </div>
                )}
                <div className="label" style={{ marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span className={`badge ${n.impact === "high" ? "badge-pending" : "badge-other"}`}>
                    live · {n.impact ?? "?"} impact
                  </span>
                  {n.source && <span>{n.source}</span>}
                  {chips(n.symbols)}
                </div>
              </div>
            </div>
          );
        })}

        {error && (
          <div className="label" style={{ padding: "8px 12px", color: "var(--down)" }} role="alert">
            ✕ {error}
          </div>
        )}
        {!error && stories == null && (
          <div className="label" style={{ padding: 14 }}>
            loading headlines… <span className="cursor-blink">▮</span>
          </div>
        )}
        {stories != null && rows.length === 0 && liveShown.length === 0 && (
          <div className="label" style={{ padding: 14, lineHeight: 1.8 }}>
            no recent stories{scope === "symbol" ? ` for ${symbol} — try ALL` : ""}
          </div>
        )}

        {rows.map((s) => (
          <div
            key={s.id}
            style={{
              padding: "8px 12px",
              borderBottom: "1px solid rgba(28,41,38,.5)",
              display: "flex",
              gap: 10,
              alignItems: "baseline",
            }}
          >
            <span className="label" style={{ flexShrink: 0, width: 52 }}>
              {when(new Date(s.created_at))}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--ink)", textDecoration: "none", fontSize: 12 }}
                >
                  {s.headline} <span style={{ color: "var(--ink-faint)", fontSize: 10 }}>↗</span>
                </a>
              ) : (
                <span style={{ fontSize: 12 }}>{s.headline}</span>
              )}
              <div className="label" style={{ marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span>{s.source}</span>
                {chips(s.symbols)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
