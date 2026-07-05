"use client";

import { useEffect, useState } from "react";
import { fmtNum } from "@/lib/types";

/**
 * Global toast stack + chirps + desktop notifications for stream events:
 * price alerts, order fills, and auto-research notes.
 */

interface Toast {
  key: number;
  border: string;
  glow: string;
  title: string;
  titleColor: string;
  body: string;
}

function chirp(freqs: [number, number]) {
  try {
    const ctx = new AudioContext();
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.06, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.12);
    });
  } catch {
    /* audio blocked — toast still shows */
  }
}

function notify(title: string, body: string) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body: `${body} — VIBETRADER` });
  }
}

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = (t: Omit<Toast, "key">) =>
    setToasts((ts) => [...ts, { ...t, key: Date.now() + Math.random() }]);

  useEffect(() => {
    const onAlert = (e: Event) => {
      const m = (e as CustomEvent).detail;
      chirp([880, 1320]);
      const body = `crossed ${m.op} ${fmtNum(m.price)} — now ${fmtNum(m.hit)}`;
      push({
        border: "var(--accent)",
        glow: "rgba(34,211,238,0.25)",
        title: `⚡ ALERT ${m.symbol}`,
        titleColor: "var(--accent)",
        body,
      });
      notify(`⚡ ${m.symbol} ${m.op} ${fmtNum(m.price)}`, `hit ${fmtNum(m.hit)}`);
    };

    const onTrade = (e: Event) => {
      const m = (e as CustomEvent).detail;
      if (!["fill", "partial_fill"].includes(m.event)) return;
      chirp([660, 990]);
      const buy = m.side === "buy";
      const body = `${m.qty ? fmtNum(m.qty, undefined) + " " : ""}${m.symbol}${
        m.price ? ` @ ${fmtNum(m.price)}` : ""
      }${m.event === "partial_fill" ? " (partial)" : ""}`;
      push({
        border: buy ? "var(--up)" : "var(--down)",
        glow: buy ? "rgba(38,166,154,0.25)" : "rgba(239,83,80,0.25)",
        title: `✓ ${m.side?.toUpperCase()} FILLED`,
        titleColor: buy ? "var(--up)" : "var(--down)",
        body,
      });
      notify(`✓ ${m.side?.toUpperCase()} ${m.symbol} filled`, body);
    };

    const onResearch = (e: Event) => {
      const m = (e as CustomEvent).detail;
      push({
        border: "var(--line-bright)",
        glow: "rgba(44,64,59,0.4)",
        title: "⌕ AUTO-RESEARCH",
        titleColor: "var(--ink-dim)",
        body: m.title ?? m.symbol,
      });
    };

    const onNews = (e: Event) => {
      const m = (e as CustomEvent).detail;
      const color =
        m.sentiment === "bullish"
          ? "var(--up)"
          : m.sentiment === "bearish"
            ? "var(--down)"
            : "var(--ink-dim)";
      push({
        border: color,
        glow: "rgba(0,0,0,0)",
        title: `📰 ${(m.symbols ?? []).join(" ")} ${m.sentiment?.toUpperCase() ?? ""}`,
        titleColor: color,
        body: `${m.headline}${m.note ? ` — ${m.note}` : ""}`,
      });
      if (m.impact === "high") notify(`📰 ${m.headline}`, m.note ?? "");
    };

    window.addEventListener("vt:alert", onAlert);
    window.addEventListener("vt:trade", onTrade);
    window.addEventListener("vt:research-note", onResearch);
    window.addEventListener("vt:news", onNews);
    return () => {
      window.removeEventListener("vt:alert", onAlert);
      window.removeEventListener("vt:trade", onTrade);
      window.removeEventListener("vt:research-note", onResearch);
      window.removeEventListener("vt:news", onNews);
    };
  }, []);

  useEffect(() => {
    if (!toasts.length) return;
    const t = setTimeout(() => setToasts((ts) => ts.slice(1)), 8000);
    return () => clearTimeout(t);
  }, [toasts]);

  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 80,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 340,
      }}
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.key}
          className="reveal"
          style={{
            background: "var(--panel-raised)",
            border: `1px solid ${t.border}`,
            boxShadow: `0 0 24px ${t.glow}`,
            padding: "10px 14px",
            fontSize: 12,
          }}
        >
          <span
            className="display"
            style={{ color: t.titleColor, fontWeight: 700, letterSpacing: "0.1em" }}
          >
            {t.title}
          </span>{" "}
          {t.body}
        </div>
      ))}
    </div>
  );
}
