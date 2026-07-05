"use client";

import { useEffect, useState } from "react";
import { usePoll } from "@/hooks/usePoll";
import { fmtNum } from "@/lib/types";
import { Panel } from "./Panel";

interface Alert {
  id: string;
  symbol: string;
  op: "above" | "below";
  price: number;
  triggered?: { price: number; at: number };
}

export function AlertsPanel({ symbol }: { symbol: string }) {
  const { data: alerts, refresh } = usePoll<Alert[]>("/api/alerts", 30_000);
  const [op, setOp] = useState<"above" | "below">("above");
  const [price, setPrice] = useState("");
  const [notifState, setNotifState] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    setNotifState("Notification" in window ? Notification.permission : "unsupported");
  }, []);

  // toasts/chirps/desktop notifications live in ToastHost — just refresh the list
  useEffect(() => {
    const onAlert = () => refresh();
    window.addEventListener("vt:alert", onAlert);
    return () => window.removeEventListener("vt:alert", onAlert);
  }, [refresh]);

  const add = async () => {
    const p = parseFloat(price);
    if (!(p > 0)) return;
    await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, op, price: p }),
    });
    setPrice("");
    refresh();
  };

  const remove = async (id: string) => {
    await fetch(`/api/alerts/${id}`, { method: "DELETE" });
    refresh();
  };

  const enableNotifications = async () => {
    if (!("Notification" in window)) return;
    setNotifState(await Notification.requestPermission());
  };

  return (
    <>
      <Panel
        title="Alerts"
        right={
          notifState === "default" ? (
            <button className="btn btn-ghost" style={{ fontSize: 9, color: "var(--accent)" }} onClick={enableNotifications}>
              ENABLE DESKTOP
            </button>
          ) : (
            <span className="label" style={{ color: notifState === "granted" ? "var(--up)" : "var(--ink-faint)" }}>
              {notifState === "granted" ? "desktop on" : notifState === "denied" ? "desktop blocked" : ""}
            </span>
          )
        }
      >
        <div style={{ padding: 8, display: "flex", gap: 6, borderBottom: "1px solid var(--line)" }}>
          <span
            className="display"
            style={{ fontSize: 12, fontWeight: 600, alignSelf: "center", minWidth: 62 }}
          >
            {symbol}
          </span>
          <div className="seg" style={{ width: 96, flexShrink: 0 }}>
            <button className={op === "above" ? "active" : ""} style={op === "above" ? { color: "var(--up)" } : {}} onClick={() => setOp("above")}>
              ≥
            </button>
            <button className={op === "below" ? "active" : ""} style={op === "below" ? { color: "var(--down)" } : {}} onClick={() => setOp("below")}>
              ≤
            </button>
          </div>
          <input
            className="field"
            type="number"
            min="0"
            step="any"
            placeholder="PRICE_"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            aria-label="Alert price"
          />
          <button className="btn" style={{ padding: "6px 12px" }} onClick={add} disabled={!(parseFloat(price) > 0)}>
            +
          </button>
        </div>
        <div style={{ overflowY: "auto", maxHeight: 180 }}>
          {!alerts || alerts.length === 0 ? (
            <div className="label" style={{ padding: 12 }}>
              no alerts set
            </div>
          ) : (
            alerts.map((a) => (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 12px",
                  fontSize: 12,
                  borderBottom: "1px solid rgba(28,41,38,.5)",
                  opacity: a.triggered ? 0.55 : 1,
                }}
              >
                <span className="display" style={{ fontWeight: 600, flex: 1 }}>
                  {a.symbol}
                </span>
                <span className={a.op === "above" ? "num-up" : "num-down"}>
                  {a.op === "above" ? "≥" : "≤"} {fmtNum(a.price)}
                </span>
                {a.triggered ? (
                  <span className="badge badge-filled">✓ hit {fmtNum(a.triggered.price)}</span>
                ) : (
                  <span className="badge badge-pending">armed</span>
                )}
                <button
                  className="btn btn-ghost"
                  style={{ color: "var(--ink-faint)", fontSize: 10 }}
                  onClick={() => remove(a.id)}
                  aria-label={`Delete alert ${a.symbol} ${a.op} ${a.price}`}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      </Panel>
    </>
  );
}
