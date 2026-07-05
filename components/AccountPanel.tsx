"use client";

import { usePoll } from "@/hooks/usePoll";
import { Account, PortfolioHistory, fmtUsd } from "@/lib/types";
import { Panel } from "./Panel";
import { Sparkline } from "./Sparkline";

export function AccountPanel() {
  const { data: account } = usePoll<Account>("/api/account", 10_000);
  const { data: history } = usePoll<PortfolioHistory>("/api/history?period=1M", 60_000);

  const equity = account ? parseFloat(account.equity) : null;
  const lastEquity = account ? parseFloat(account.last_equity) : null;
  const dayPl = equity != null && lastEquity != null ? equity - lastEquity : null;
  const dayPlPct = dayPl != null && lastEquity ? dayPl / lastEquity : null;
  const up = (dayPl ?? 0) >= 0;

  return (
    <Panel title="Account" right={<span className="label">{account?.account_number ?? "…"}</span>}>
      <div style={{ padding: "14px 12px 6px" }}>
        <div className="label">Equity</div>
        <div
          className={`display ${up ? "glow-up" : "glow-down"}`}
          style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.1, letterSpacing: "0.02em" }}
        >
          {fmtUsd(equity)}
        </div>
        <div style={{ fontSize: 13, marginTop: 2 }} className={up ? "num-up" : "num-down"}>
          {dayPl != null ? `${up ? "▲" : "▼"} ${fmtUsd(Math.abs(dayPl))}` : "—"}
          {dayPlPct != null && (
            <span style={{ color: "var(--ink-dim)", marginLeft: 8 }}>
              {(dayPlPct * 100).toFixed(2)}% today
            </span>
          )}
        </div>
      </div>

      {history?.equity && (
        <div style={{ padding: "4px 4px 0" }}>
          <Sparkline
            values={history.equity.filter((v): v is number => v != null)}
            timestamps={history.timestamp}
          />
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          borderTop: "1px solid var(--line)",
        }}
      >
        <div style={{ padding: "10px 12px", borderRight: "1px solid var(--line)" }}>
          <div className="label">Cash</div>
          <div style={{ fontSize: 15 }}>{fmtUsd(account?.cash)}</div>
        </div>
        <div style={{ padding: "10px 12px" }}>
          <div className="label">Buying Power</div>
          <div style={{ fontSize: 15, color: "var(--accent)" }}>{fmtUsd(account?.buying_power)}</div>
        </div>
      </div>
    </Panel>
  );
}
