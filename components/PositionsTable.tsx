"use client";

import { useState } from "react";
import { usePoll } from "@/hooks/usePoll";
import { Position, displaySymbol, fmtUsd, fmtNum, fmtPct } from "@/lib/types";
import { Panel } from "./Panel";

export function PositionsTable({ onSelect }: { onSelect: (s: string) => void }) {
  const { data: positions, refresh } = usePoll<Position[]>("/api/positions", 10_000);
  const [armed, setArmed] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = async (p: Position) => {
    if (armed !== p.symbol) {
      setArmed(p.symbol);
      setError(null);
      return;
    }
    setClosing(p.symbol);
    setArmed(null);
    try {
      const res = await fetch(`/api/positions/${encodeURIComponent(p.symbol)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "close failed");
      }
      refresh();
      window.dispatchEvent(new Event("vt:refresh"));
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      const m = text.match(/"message"\s*:\s*"([^"]+)"/);
      setError(`${displaySymbol(p)}: ${m ? m[1] : text.slice(0, 100)}`);
    } finally {
      setClosing(null);
    }
  };

  return (
    <Panel
      title="Positions"
      right={<span className="label">{positions?.length ?? 0} open</span>}
    >
      <div style={{ overflow: "auto", flex: 1, minWidth: 0 }}>
        {error && (
          <div
            className="label"
            style={{ padding: "6px 12px", color: "var(--down)", borderBottom: "1px solid var(--line)" }}
            role="alert"
          >
            ✕ {error}
          </div>
        )}
        {!positions || positions.length === 0 ? (
          <div className="label" style={{ padding: 16 }}>
            {positions ? "no open positions — the tape awaits" : "loading…"}
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Sym</th>
                <th>Qty</th>
                <th>Avg</th>
                <th>Last</th>
                <th>Mkt Val</th>
                <th>P/L</th>
                <th>P/L %</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const pl = parseFloat(p.unrealized_pl);
                const up = pl >= 0;
                const sym = displaySymbol(p);
                const isArmed = armed === p.symbol;
                return (
                  <tr key={p.symbol} onClick={() => onSelect(sym)} style={{ cursor: "pointer" }}>
                    <td className="display" style={{ fontWeight: 600 }}>
                      {sym}
                      {p.side === "short" && (
                        <span className="label" style={{ marginLeft: 6, color: "var(--amber)" }}>
                          short
                        </span>
                      )}
                    </td>
                    <td>{fmtNum(p.qty, p.asset_class === "crypto" ? 6 : 0)}</td>
                    <td>{fmtNum(p.avg_entry_price)}</td>
                    <td>{fmtNum(p.current_price)}</td>
                    <td>{fmtUsd(p.market_value)}</td>
                    <td className={up ? "num-up" : "num-down"}>
                      {up ? "+" : ""}
                      {fmtUsd(pl)}
                    </td>
                    <td className={up ? "num-up" : "num-down"}>{fmtPct(p.unrealized_plpc)}</td>
                    <td>
                      <button
                        className="btn btn-ghost"
                        style={{
                          fontSize: 10,
                          color: isArmed ? "var(--amber)" : "var(--down)",
                          borderColor: isArmed ? "var(--amber)" : "transparent",
                        }}
                        disabled={closing === p.symbol}
                        onClick={(e) => {
                          e.stopPropagation();
                          close(p);
                        }}
                        onBlur={() => setArmed((a) => (a === p.symbol ? null : a))}
                      >
                        {closing === p.symbol ? "…" : isArmed ? "SURE?" : "CLOSE"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  );
}
