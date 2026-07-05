"use client";

import { usePoll } from "@/hooks/usePoll";
import { useStream } from "@/hooks/useStream";
import { Snapshot, snapPrice, fmtNum } from "@/lib/types";

export function TickerTape({ symbols }: { symbols: string[] }) {
  const { data } = usePoll<Record<string, Snapshot>>(
    symbols.length ? `/api/snapshots?symbols=${encodeURIComponent(symbols.join(","))}` : null,
    15_000
  );
  const { prices: live } = useStream();

  const items = symbols.map((sym) => {
    const { price, chg } = snapPrice(data?.[sym], live[sym]?.p);
    return { sym, price, chg };
  });

  const run = (key: string) => (
    <div key={key} style={{ display: "inline-flex" }} aria-hidden={key === "b"}>
      {items.map(({ sym, price, chg }) => {
        const up = (chg ?? 0) >= 0;
        return (
          <span
            key={`${key}-${sym}`}
            style={{ display: "inline-flex", gap: 8, padding: "6px 22px", alignItems: "baseline" }}
          >
            <span className="display" style={{ fontWeight: 600, fontSize: 12, letterSpacing: "0.08em" }}>
              {sym}
            </span>
            <span style={{ color: "var(--ink-dim)" }}>{price != null ? fmtNum(price) : "—"}</span>
            {chg != null && (
              <span className={up ? "num-up" : "num-down"} style={{ fontSize: 11 }}>
                {up ? "▲" : "▼"}
                {Math.abs(chg * 100).toFixed(2)}%
              </span>
            )}
          </span>
        );
      })}
    </div>
  );

  return (
    <div className="tape">
      <div className="tape-inner">
        {run("a")}
        {run("b")}
      </div>
    </div>
  );
}
