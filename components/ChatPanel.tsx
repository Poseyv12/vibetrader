"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { DraftOrder, fmtNum } from "@/lib/types";
import { Panel } from "./Panel";

type Line =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "note"; text: string }
  | { kind: "error"; text: string }
  | { kind: "draft"; draft: DraftOrder };

/**
 * Turn a propose_trade tool call's raw args into a DraftOrder for the card.
 * Mirrors the server-side validation in chat-tools — brackets are dropped for
 * crypto/notional, garbage is rejected. Loading the card only pre-fills the
 * ticket; the user still arms + confirms there.
 */
function draftFromArgs(a: Record<string, unknown>): DraftOrder | null {
  const symbol = String(a.symbol ?? "").toUpperCase().trim();
  const qty = Number(a.qty) || 0;
  const notional = Number(a.notional) || 0;
  if (!/^[A-Z0-9./]{1,12}$/.test(symbol) || (qty <= 0 && notional <= 0)) return null;
  const crypto = symbol.includes("/");
  const side = a.side === "sell" ? "sell" : "buy";
  const limit = Number(a.limit_price) || 0;
  const tp = crypto ? 0 : Number(a.take_profit) || 0;
  const sl = crypto ? 0 : Number(a.stop_loss) || 0;
  const bracket = qty > 0 && tp > 0 && sl > 0 && (side === "buy" ? tp > sl : tp < sl);
  return {
    symbol,
    side,
    type: a.type === "limit" && limit > 0 ? "limit" : "market",
    mode: qty > 0 ? "qty" : "notional",
    amount: qty > 0 ? qty : notional,
    ...(a.type === "limit" && limit > 0 ? { limit_price: limit } : {}),
    ...(bracket ? { take_profit: tp, stop_loss: sl } : {}),
    ...(typeof a.rationale === "string" && a.rationale ? { rationale: a.rationale } : {}),
    source: "copilot",
  };
}

function DraftCard({ draft }: { draft: DraftOrder }) {
  const buy = draft.side === "buy";
  const sideColor = buy ? "var(--up)" : "var(--down)";
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderLeft: `2px solid ${sideColor}`,
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 5,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="label" style={{ color: "var(--amber)" }}>
          ⚑ {draft.source === "scout" ? "scout pick" : "ai draft"}
        </span>
        <span style={{ color: sideColor, fontWeight: 700 }}>
          {draft.side.toUpperCase()} {draft.symbol}
        </span>
        {draft.conviction && (
          <span className="label" style={{ marginLeft: "auto" }}>
            {draft.conviction} conviction
          </span>
        )}
      </div>
      <div style={{ color: "var(--ink-dim)", fontSize: 11 }}>
        {draft.mode === "qty" ? `${fmtNum(draft.amount)} sh` : `$${fmtNum(draft.amount)}`}
        {" · "}
        {draft.type === "limit" && draft.limit_price ? `lmt ${fmtNum(draft.limit_price)}` : "mkt"}
        {draft.take_profit != null && draft.stop_loss != null && (
          <>
            {" · "}
            <span style={{ color: "var(--up)" }}>TP {fmtNum(draft.take_profit)}</span>
            {" / "}
            <span style={{ color: "var(--down)" }}>SL {fmtNum(draft.stop_loss)}</span>
          </>
        )}
      </div>
      {draft.rationale && (
        <div className="label" style={{ lineHeight: 1.5 }}>{draft.rationale}</div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          className="btn"
          style={{ fontSize: 10, padding: "4px 10px", color: "var(--accent)" }}
          onClick={() =>
            window.dispatchEvent(new CustomEvent<DraftOrder>("vt:draft-order", { detail: draft }))
          }
        >
          LOAD TICKET →
        </button>
        <span className="label">nothing placed — you confirm in the ticket</span>
      </div>
    </div>
  );
}

export function ChatPanel({ symbol, watchlist = [] }: { symbol: string; watchlist?: string[] }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines, status]);

  const pin = async (index: number) => {
    const answer = lines[index];
    if (answer?.kind !== "assistant") return;
    // title: the user question that led to this answer
    const q = [...lines.slice(0, index)]
      .reverse()
      .find((l): l is Extract<Line, { kind: "user" }> => l.kind === "user");
    await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: q?.text.slice(0, 80) ?? "copilot note", content: answer.text }),
    });
    window.dispatchEvent(new Event("vt:refresh"));
  };

  const send = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setStatus("connecting…");
    const nextLines: Line[] = [...lines, { kind: "user", text: q }];
    setLines(nextLines);

    // history for the model: only real chat turns, not notes/errors
    const history = nextLines
      .filter((l): l is Extract<Line, { kind: "user" | "assistant" }> =>
        ["user", "assistant"].includes(l.kind)
      )
      .map((l) => ({ role: l.kind, content: l.text }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.body) throw new Error("no response stream");

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const m = JSON.parse(line.slice(6));
          if (m.type === "status") setStatus(m.text);
          else if (m.type === "tool") {
            setStatus(`querying ${m.name}…`);
            // propose_trade calls become draft cards, not log lines
            const draft = m.name === "propose_trade" ? draftFromArgs(m.args ?? {}) : null;
            setLines((ls) => [
              ...ls,
              draft
                ? { kind: "draft", draft }
                : {
                    kind: "note",
                    text: `▸ ${m.name}${m.args && Object.keys(m.args).length ? " " + JSON.stringify(m.args) : ""}`,
                  },
            ]);
          } else if (m.type === "content") {
            setLines((ls) => [...ls, { kind: "assistant", text: m.text }]);
          } else if (m.type === "error") {
            setLines((ls) => [...ls, { kind: "error", text: m.text }]);
          }
        }
      }
    } catch (e) {
      setLines((ls) => [
        ...ls,
        { kind: "error", text: e instanceof Error ? e.message : String(e) },
      ]);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  // questions from the header command line land here
  const sendRef = useRef(send);
  sendRef.current = send;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    const onAsk = (e: Event) => {
      const q = (e as CustomEvent<{ q?: string }>).detail?.q?.trim();
      if (!q) return;
      setCollapsed(false);
      rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      if (busyRef.current) {
        setLines((ls) => [
          ...ls,
          { kind: "note", text: `▸ still answering — ask again in a moment: "${q}"` },
        ]);
        return;
      }
      sendRef.current(q);
    };
    window.addEventListener("vt:ask", onAsk);
    return () => window.removeEventListener("vt:ask", onAsk);
  }, []);

  // scout: server gathers screeners/technicals/headlines deterministically,
  // one synthesis-only model call picks setups. Picks arrive as drafts —
  // suggestions only; every trade still goes through the ticket's confirm.
  const scout = async () => {
    if (busy) return;
    setBusy(true);
    setStatus("scouting movers, actives & your watchlist…");
    setLines((ls) => [...ls, { kind: "user", text: "scout the market for setups" }]);
    try {
      const res = await fetch("/api/scout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ watchlist }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "scout failed");
      const picks: DraftOrder[] = Array.isArray(body.picks) ? body.picks : [];
      setLines((ls) => [
        ...ls,
        { kind: "assistant", text: body.summary || "scout run complete" },
        ...picks.map((draft): Line => ({ kind: "draft", draft })),
      ]);
      if (body.journaled) window.dispatchEvent(new Event("vt:refresh"));
    } catch (e) {
      setLines((ls) => [
        ...ls,
        { kind: "error", text: e instanceof Error ? e.message : String(e) },
      ]);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  return (
    <div
      ref={rootRef}
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
    >
    <Panel
      title="Copilot"
      right={
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="label" style={{ color: "var(--amber)" }} title="the AI can research and draft — only you can place a trade">
            
          </span>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 10, color: "var(--ink-faint)" }}
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
          >
            {collapsed ? "▲" : "▼"}
          </button>
        </span>
      }
    >
      {!collapsed && (
        <>
          <div
            ref={scrollRef}
            style={{
              height: 360,
              overflowY: "auto",
              padding: "10px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontSize: 12,
            }}
          >
            {lines.length === 0 && (
              <div className="label" style={{ lineHeight: 1.8 }}>
                research analyst
                <br />» research {symbol} — technicals + news + levels
                <br />» market briefing — movers, actives, headlines
                <br />» scout — ai-picked setups; you confirm every trade
                <br />» how is my portfolio positioned?
              </div>
            )}
            {lines.map((l, i) =>
              l.kind === "user" ? (
                <div key={i} style={{ color: "var(--accent)" }}>
                  <span style={{ color: "var(--ink-faint)" }}>{">"}</span> {l.text}
                </div>
              ) : l.kind === "note" ? (
                <div key={i} className="label" style={{ paddingLeft: 12 }}>
                  {l.text}
                </div>
              ) : l.kind === "error" ? (
                <div key={i} style={{ color: "var(--down)" }}>
                  ✕ {l.text}
                </div>
              ) : l.kind === "draft" ? (
                <DraftCard key={i} draft={l.draft} />
              ) : (
                <div key={i} style={{ position: "relative" }}>
                  <div className="chat-md">
                    <ReactMarkdown>{l.text}</ReactMarkdown>
                  </div>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 10, color: "var(--ink-faint)", padding: "2px 6px" }}
                    title="Pin to today's research"
                    onClick={() => pin(i)}
                  >
                    ⌖ pin to research
                  </button>
                </div>
              )
            )}
            {status && (
              <div className="label" style={{ color: "var(--accent)" }}>
                {status} <span className="cursor-blink">▮</span>
              </div>
            )}
          </div>
          <div
            style={{
              display: "flex",
              gap: 6,
              padding: "8px 8px 0",
              flexWrap: "wrap",
            }}
          >
            {([
              { label: `⌕ ${symbol}`, run: () => send(`research ${symbol}`) },
              { label: "◈ briefing", run: () => send("market briefing") },
              { label: "◉ scout", run: scout, title: "AI-suggested setups — drafts only, you confirm" },
              { label: "◎ portfolio", run: () => send("review my portfolio: how is each position doing, any relevant news?") },
            ] as { label: string; run: () => void; title?: string }[]).map((c) => (
              <button
                key={c.label}
                className="btn btn-ghost"
                style={{
                  fontSize: 10,
                  border: "1px solid var(--line)",
                  color: "var(--accent)",
                  padding: "3px 9px",
                }}
                disabled={busy}
                title={c.title}
                onClick={c.run}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, padding: 8, borderTop: "none" }}>
            <input
              className="field"
              placeholder="RESEARCH A TICKER, THE MARKET, OR YOUR BOOK_"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              disabled={busy}
              aria-label="Ask the copilot"
            />
            <button className="btn" style={{ padding: "6px 14px" }} onClick={() => send()} disabled={busy || !input.trim()}>
              {busy ? "…" : "ASK"}
            </button>
          </div>
        </>
      )}
    </Panel>
    </div>
  );
}
