"use client";

import { useState } from "react";
import { usePoll } from "@/hooks/usePoll";
import { useStream } from "@/hooks/useStream";
import { Snapshot, snapPrice, fmtNum } from "@/lib/types";
import { Panel } from "./Panel";

export function Watchlist({
  symbols,
  selected,
  onSelect,
  onAdd,
  onRemove,
}: {
  symbols: string[];
  selected: string;
  onSelect: (s: string) => void;
  onAdd: (s: string) => void;
  onRemove: (s: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const { prices: live } = useStream();
  const { data } = usePoll<Record<string, Snapshot>>(
    symbols.length ? `/api/snapshots?symbols=${encodeURIComponent(symbols.join(","))}` : null,
    10_000
  );

  const submit = () => {
    const sym = draft.trim().toUpperCase();
    // equities (AAPL, BRK.B) or crypto pairs (BTC/USD, ETH/BTC)
    if (sym && /^[A-Z.]{1,6}(\/(USD|USDT|USDC|BTC))?$/.test(sym)) {
      onAdd(sym);
      setDraft("");
    }
  };

  return (
    <Panel title="Watchlist" className="flex-1">
      <div style={{ padding: 8, borderBottom: "1px solid var(--line)", display: "flex", gap: 6 }}>
        <input
          className="field"
          placeholder="ADD SYMBOL / BTC/USD_"
          value={draft}
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          maxLength={11}
          aria-label="Add symbol to watchlist"
        />
        <button className="btn" onClick={submit} style={{ padding: "6px 12px" }}>
          +
        </button>
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {symbols.map((sym) => {
          const { price, chg } = snapPrice(data?.[sym], live[sym]?.p);
          const up = (chg ?? 0) >= 0;
          const active = sym === selected;
          return (
            <div
              key={sym}
              onClick={() => onSelect(sym)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                cursor: "pointer",
                borderBottom: "1px solid rgba(28,41,38,.5)",
                borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
                background: active ? "var(--panel-raised)" : "transparent",
              }}
            >
              <span className="display" style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
                {sym}
              </span>
              <span style={{ fontSize: 12 }}>{price != null ? fmtNum(price) : "—"}</span>
              <span
                className={up ? "num-up" : "num-down"}
                style={{ fontSize: 11, width: 62, textAlign: "right" }}
              >
                {chg != null ? `${up ? "+" : ""}${(chg * 100).toFixed(2)}%` : "—"}
              </span>
              <button
                className="btn btn-ghost"
                style={{ color: "var(--ink-faint)", fontSize: 10 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(sym);
                }}
                aria-label={`Remove ${sym}`}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
