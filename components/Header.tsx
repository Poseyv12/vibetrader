"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePoll } from "@/hooks/usePoll";
import { Clock } from "@/lib/types";

export function Header() {
  const { data: clock } = usePoll<Clock>("/api/clock", 60_000);
  const [now, setNow] = useState<string>("");
  const [fullscreen, setFullscreen] = useState(false);

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
        alpaca paper terminal
      </span>
      <span style={{ flex: 1 }} />
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
