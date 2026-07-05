"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { usePoll } from "@/hooks/usePoll";
import { Panel } from "./Panel";

interface Note {
  id: string;
  date: string;
  title: string;
  content: string;
  source: "copilot" | "generated";
  created: number;
}

export function ResearchPanel() {
  const { data: notes, refresh } = usePoll<Note[]>("/api/research", 30_000);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Note[] | null>(null);
  const [searching, setSearching] = useState(false);

  const runSearch = async () => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/research/search?q=${encodeURIComponent(q)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "search failed");
      setResults(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  const today = new Date().toLocaleDateString("en-CA");
  const todays = (notes ?? []).filter((n) => n.date === today);
  const earlier = (notes ?? []).filter((n) => n.date !== today);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/research/generate", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "generation failed");
      setOpen(body.id);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/research/${id}`, { method: "DELETE" });
    refresh();
  };

  const noteRow = (n: Note) => {
    const isOpen = open === n.id;
    return (
      <div key={n.id} style={{ borderBottom: "1px solid rgba(28,41,38,.5)" }}>
        <div
          onClick={() => setOpen(isOpen ? null : n.id)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px",
            cursor: "pointer",
            background: isOpen ? "var(--panel-raised)" : "transparent",
          }}
        >
          <span style={{ color: isOpen ? "var(--accent)" : "var(--ink-faint)", fontSize: 10 }}>
            {isOpen ? "▼" : "▸"}
          </span>
          <span className="display" style={{ fontWeight: 600, fontSize: 12, flex: 1 }}>
            {n.title}
          </span>
          <span className={`badge ${n.source === "generated" ? "badge-pending" : "badge-other"}`}>
            {n.source === "generated" ? "agent" : "pinned"}
          </span>
          <span className="label">
            {new Date(n.created).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </span>
          <button
            className="btn btn-ghost"
            style={{ color: "var(--ink-faint)", fontSize: 10 }}
            onClick={(e) => {
              e.stopPropagation();
              remove(n.id);
            }}
            aria-label={`Delete ${n.title}`}
          >
            ✕
          </button>
        </div>
        {isOpen && (
          <div className="chat-md" style={{ padding: "4px 16px 14px 32px", fontSize: 12 }}>
            <ReactMarkdown>{n.content}</ReactMarkdown>
          </div>
        )}
      </div>
    );
  };

  return (
    <Panel
      title={`Research // ${today}`}
      right={
        <button
          className="btn"
          style={{
            fontSize: 10,
            padding: "4px 12px",
            color: generating ? "var(--amber)" : "var(--accent)",
            borderColor: generating ? "var(--amber)" : "var(--line-bright)",
          }}
          onClick={generate}
          disabled={generating}
        >
          {generating ? "RESEARCHING…" : "◈ GENERATE"}
        </button>
      }
    >
      <div style={{ display: "flex", gap: 6, padding: 8, borderBottom: "1px solid var(--line)" }}>
        <input
          className="field"
          placeholder="SEMANTIC SEARCH — WHAT DID I LEARN ABOUT…_"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch()}
          aria-label="Search research journal"
        />
        <button className="btn" style={{ padding: "6px 12px" }} onClick={runSearch} disabled={searching}>
          {searching ? "…" : "⌕"}
        </button>
        {results && (
          <button
            className="btn btn-ghost"
            style={{ color: "var(--ink-faint)" }}
            onClick={() => {
              setResults(null);
              setQuery("");
            }}
          >
            ✕
          </button>
        )}
      </div>
      <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
        {results && (
          <div className="label" style={{ padding: "8px 12px", borderBottom: "1px solid var(--line)", color: "var(--accent)" }}>
            {results.length ? `${results.length} matches by meaning` : "no matches"}
          </div>
        )}
        {results?.map(noteRow)}
        {!results && error && (
          <div className="label" style={{ padding: "8px 12px", color: "var(--down)" }} role="alert">
            ✕ {error}
          </div>
        )}
        {!results && generating && (
          <div className="label" style={{ padding: "8px 12px", color: "var(--amber)" }}>
            agent is working — market scan, your book, alerts… takes a minute or two{" "}
            <span className="cursor-blink">▮</span>
          </div>
        )}
        {!results && todays.length === 0 && !generating && (
          <div className="label" style={{ padding: 14, lineHeight: 1.8 }}>
            no research yet today — hit ◈ GENERATE for the daily briefing,
            <br />
            or pin copilot answers here with ⌖
          </div>
        )}
        {!results && todays.map(noteRow)}
        {!results && earlier.length > 0 && (
          <>
            <div className="label" style={{ padding: "8px 12px", borderBottom: "1px solid var(--line)" }}>
              earlier
            </div>
            {earlier.slice(0, 10).map(noteRow)}
          </>
        )}
      </div>
    </Panel>
  );
}
