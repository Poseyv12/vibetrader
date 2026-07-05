"use client";

import { useState } from "react";
import { usePoll } from "@/hooks/usePoll";
import { Order, fmtNum } from "@/lib/types";
import { Panel } from "./Panel";

function badgeClass(status: string) {
  if (["new", "accepted", "pending_new", "partially_filled", "held"].includes(status))
    return "badge badge-pending";
  if (status === "filled") return "badge badge-filled";
  return "badge badge-other";
}

export function OrdersPanel() {
  const [tab, setTab] = useState<"open" | "closed">("open");
  const { data: orders, refresh } = usePoll<Order[]>(`/api/orders?status=${tab}`, 7_000);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const cancel = async (id: string) => {
    setCancelling(id);
    try {
      await fetch(`/api/orders/${id}`, { method: "DELETE" });
      refresh();
      window.dispatchEvent(new Event("vt:refresh"));
    } finally {
      setCancelling(null);
    }
  };

  return (
    <Panel
      title="Orders"
      right={
        <span className="seg" style={{ border: "none", gap: 2 }}>
          {(["open", "closed"] as const).map((t) => (
            <button
              key={t}
              className={t === tab ? "active" : ""}
              onClick={() => setTab(t)}
              style={{
                padding: "2px 10px",
                borderLeft: "none",
                background: t === tab ? "var(--panel-raised)" : "transparent",
                color: t === tab ? "var(--accent)" : "var(--ink-faint)",
                border: "1px solid",
                borderColor: t === tab ? "var(--line-bright)" : "var(--line)",
                cursor: "pointer",
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              {t}
            </button>
          ))}
        </span>
      }
    >
      <div style={{ overflow: "auto", flex: 1, minWidth: 0 }}>
        {!orders || orders.length === 0 ? (
          <div className="label" style={{ padding: 16 }}>
            {orders ? `no ${tab} orders` : "loading…"}
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Sym</th>
                <th>Side</th>
                <th>Qty</th>
                <th>Type</th>
                <th>Status</th>
                <th>{tab === "open" ? "" : "Fill Px"}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="display" style={{ fontWeight: 600 }}>
                    {o.symbol}
                  </td>
                  <td className={o.side === "buy" ? "num-up" : "num-down"}>
                    {o.side.toUpperCase()}
                  </td>
                  <td>
                    {o.qty ? fmtNum(o.qty, 0) : o.notional ? `$${fmtNum(o.notional, 0)}` : "—"}
                  </td>
                  <td style={{ color: "var(--ink-dim)" }}>
                    {o.type}
                    {o.limit_price ? ` @ ${fmtNum(o.limit_price)}` : ""}
                  </td>
                  <td>
                    <span className={badgeClass(o.status)}>{o.status.replace(/_/g, " ")}</span>
                  </td>
                  <td>
                    {tab === "open" ? (
                      <button
                        className="btn btn-ghost"
                        style={{ color: "var(--down)", fontSize: 10 }}
                        disabled={cancelling === o.id}
                        onClick={() => cancel(o.id)}
                      >
                        {cancelling === o.id ? "…" : "CANCEL"}
                      </button>
                    ) : o.filled_avg_price ? (
                      fmtNum(o.filled_avg_price)
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  );
}
