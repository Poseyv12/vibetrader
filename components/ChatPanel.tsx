"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Panel } from "./Panel";

type Line =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "note"; text: string }
  | { kind: "error"; text: string };

export function ChatPanel({ symbol }: { symbol: string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines, status]);

  const pin = async (index: number) => {
    const answer = lines[index];
    if (answer?.kind !== "assistant") return;
    // title: the user question that led to this answer
    const q = [...lines.slice(0, index)].reverse().find((l) => l.kind === "user");
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
            setLines((ls) => [
              ...ls,
              {
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

  return (
    <Panel
      title="Copilot"
      right={
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="label" style={{ color: "var(--amber)" }}>
            read-only
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
                research analyst · local llm via lm studio
                <br />» research {symbol} — technicals + news + levels
                <br />» market briefing — movers, actives, headlines
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
            {[
              { label: `⌕ ${symbol}`, prompt: `research ${symbol}` },
              { label: "◈ briefing", prompt: "market briefing" },
              { label: "◎ portfolio", prompt: "review my portfolio: how is each position doing, any relevant news?" },
            ].map((c) => (
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
                onClick={() => send(c.prompt)}
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
  );
}
