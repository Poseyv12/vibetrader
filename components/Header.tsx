"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePoll } from "@/hooks/usePoll";
import { Clock } from "@/lib/types";

export function Header() {
  const { data: clock } = usePoll<Clock>("/api/clock", 60_000);
  const [now, setNow] = useState<string>("");
  const [fullscreen, setFullscreen] = useState(false);
  const [ask, setAsk] = useState("");
  const askRef = useRef<HTMLInputElement>(null);

  // "/" focuses the copilot command line from anywhere (unless already typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      e.preventDefault();
      askRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submitAsk = () => {
    const q = ask.trim();
    if (!q) return;
    window.dispatchEvent(new CustomEvent("vt:ask", { detail: { q } }));
    setAsk("");
  };

  // track state from the browser, not our own toggle — Esc also exits
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement != null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleTimeString("en-US", {
          hour12: false,
          timeZone: "America/New_York",
        })
      );
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const nextEvent = clock
    ? clock.is_open
      ? `closes ${new Date(clock.next_close).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}`
      : `opens ${new Date(clock.next_open).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}`
    : "";

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "10px 14px",
      }}
    >
      <h1
        className="display"
        style={{
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: "0.28em",
          margin: 0,
        }}
      >
        VIBE<span style={{ color: "var(--accent)" }}>TRADER</span>
        <span className="cursor-blink">_</span>
      </h1>
      <span className="label" style={{ paddingTop: 2 }}>
        v1.2
      </span>
      {/* the copilot command line — the AI is the app's front door */}
      <span
        style={{
          flex: 1,
          display: "flex",
          justifyContent: "center",
          minWidth: 0,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            maxWidth: 460,
            background: "var(--surface)",
            border: "1px solid var(--line)",
            padding: "4px 10px",
          }}
        >
          <span style={{ color: "var(--accent)", fontSize: 12 }} aria-hidden>
            ◈{">"}
          </span>
          <input
            ref={askRef}
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitAsk()}
            placeholder="ASK THE COPILOT — RESEARCH, BRIEFING, DRAFT A TRADE_"
            aria-label="Ask the copilot"
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--ink)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
            }}
          />
          <span className="label" title="press / to focus">/</span>
        </span>
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11 }}>
        <span className={`led ${clock?.is_open ? "led-open" : "led-closed"}`} aria-hidden />
        <span style={{ color: clock?.is_open ? "var(--up)" : "var(--amber)", letterSpacing: "0.12em" }}>
          {clock ? (clock.is_open ? "MARKET OPEN" : "MARKET CLOSED") : "…"}
        </span>
        <span style={{ color: "var(--ink-faint)" }}>{nextEvent}</span>
      </span>
      <span style={{ fontSize: 12, color: "var(--ink-dim)", minWidth: 86, textAlign: "right" }} suppressHydrationWarning>
        {now} <span className="label">ET</span>
      </span>
      <Link
        href="/performance"
        aria-label="Performance dashboard"
        className="label"
        style={{ color: "var(--ink-dim)", textDecoration: "none" }}
      >
        ▤ PERF
      </Link>
      <Link
        href="/settings"
        aria-label="Settings"
        style={{ color: "var(--ink-faint)", fontSize: 15, textDecoration: "none", lineHeight: 1 }}
      >
        ⚙
      </Link>
      <button
        onClick={toggleFullscreen}
        aria-label={fullscreen ? "Exit full screen" : "Enter full screen"}
        title={fullscreen ? "exit full screen (esc)" : "full screen"}
        style={{
          background: "transparent",
          border: "none",
          color: fullscreen ? "var(--accent)" : "var(--ink-faint)",
          fontSize: 15,
          lineHeight: 1,
          cursor: "pointer",
          padding: 0,
        }}
      >
        ⛶
      </button>
    </header>
  );
}
