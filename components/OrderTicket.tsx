"use client";

import { useEffect, useState } from "react";
import { usePoll } from "@/hooks/usePoll";
import { useStream } from "@/hooks/useStream";
import { Account, Snapshot, snapPrice, fmtUsd } from "@/lib/types";
import { Panel } from "./Panel";

type Side = "buy" | "sell";
type Mode = "qty" | "notional";
type OrdType = "market" | "limit";

export function OrderTicket({ symbol }: { symbol: string }) {
  const [side, setSide] = useState<Side>("buy");
  const [mode, setMode] = useState<Mode>("qty");
  const [type, setType] = useState<OrdType>("market");
  const [amount, setAmount] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [bracket, setBracket] = useState(false);
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: snap } = usePoll<Record<string, Snapshot>>(
    `/api/snapshots?symbols=${encodeURIComponent(symbol)}`,
    10_000
  );
  const { prices: live } = useStream();
  const { price } = snapPrice(snap?.[symbol], live[symbol]?.p);
  const isCrypto = symbol.includes("/");

  const { data: account } = usePoll<Account>("/api/account", 15_000);
  // margin only applies to whole-share equity orders; crypto and fractional
  // (dollar-based) orders draw from non-marginable buying power
  const marginable = !isCrypto && mode === "qty";
  const bp = account
    ? parseFloat(marginable ? account.buying_power : account.non_marginable_buying_power)
    : null;
  const regtBp = account ? parseFloat(account.regt_buying_power) : null;
  const cash = account ? parseFloat(account.cash) : null;

  // disarm when inputs change
  useEffect(
    () => setArmed(false),
    [symbol, side, mode, type, amount, limitPrice, bracket, takeProfit, stopLoss]
  );

  // brackets are equities-only; drop the legs if the user switches to crypto
  useEffect(() => {
    if (isCrypto) setBracket(false);
  }, [isCrypto]);

  const amt = parseFloat(amount);
  const tp = parseFloat(takeProfit);
  const sl = parseFloat(stopLoss);
  const bracketValid =
    !bracket || (tp > 0 && sl > 0 && (side === "buy" ? tp > sl : tp < sl));
  const valid =
    !Number.isNaN(amt) &&
    amt > 0 &&
    (type === "market" || parseFloat(limitPrice) > 0) &&
    bracketValid;

  const estCost =
    mode === "notional"
      ? amt
      : price != null
        ? amt * (type === "limit" && limitPrice ? parseFloat(limitPrice) : price)
        : null;

  const submit = async () => {
    if (!armed) {
      setArmed(true);
      setMsg(null);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          side,
          type,
          ...(mode === "qty" ? { qty: amt } : { notional: amt }),
          ...(type === "limit" ? { limit_price: parseFloat(limitPrice) } : {}),
          ...(bracket ? { take_profit: tp, stop_loss: sl } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "order rejected");
      setMsg({
        ok: true,
        text: `${side.toUpperCase()} ${symbol} submitted — ${body.status}`,
      });
      setAmount("");
      window.dispatchEvent(new Event("vt:refresh"));
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      // Alpaca errors come back as JSON strings; surface just the message
      const m = text.match(/"message"\s*:\s*"([^"]+)"/);
      setMsg({ ok: false, text: m ? m[1] : text.slice(0, 140) });
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  return (
    <Panel
      title="Order Ticket"
      right={
        <span className="label" style={isCrypto ? { color: "var(--accent)" } : {}}>
          {isCrypto ? "crypto · 24/7 · gtc" : "paper"}
        </span>
      }
    >
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span className="display" style={{ fontSize: 20, fontWeight: 700 }}>
            {symbol}
          </span>
          <span style={{ color: "var(--ink-dim)", fontSize: 12 }}>
            last {price != null ? fmtUsd(price) : "—"}
          </span>
        </div>

        <div className="seg" role="radiogroup" aria-label="Side">
          <button className={side === "buy" ? "active" : ""} style={side === "buy" ? { color: "var(--up)" } : {}} onClick={() => setSide("buy")}>
            BUY
          </button>
          <button className={side === "sell" ? "active" : ""} style={side === "sell" ? { color: "var(--down)" } : {}} onClick={() => setSide("sell")}>
            SELL
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div className="seg">
            <button className={mode === "qty" ? "active" : ""} onClick={() => setMode("qty")}>
              SHARES
            </button>
            <button
              className={mode === "notional" ? "active" : ""}
              onClick={() => setMode("notional")}
              disabled={bracket}
              style={bracket ? { opacity: 0.35, cursor: "not-allowed" } : {}}
              title={bracket ? "bracket orders need share qty" : undefined}
            >
              DOLLARS
            </button>
          </div>
          <div className="seg">
            <button className={type === "market" ? "active" : ""} onClick={() => setType("market")}>
              MKT
            </button>
            <button className={type === "limit" ? "active" : ""} onClick={() => setType("limit")}>
              LMT
            </button>
          </div>
        </div>

        <input
          className="field"
          type="number"
          min="0"
          step="any"
          placeholder={mode === "qty" ? "QUANTITY_" : "DOLLAR AMOUNT_"}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label={mode === "qty" ? "Quantity" : "Dollar amount"}
        />

        {side === "buy" && bp != null && bp > 0 && price != null && price > 0 && (
          <div style={{ display: "flex", gap: 6 }}>
            {([0.25, 0.5, 1] as const).map((f) => {
              // shave MAX so a market order can't overshoot BP on a tick up
              const spend = bp * f * (f === 1 ? 0.98 : 1);
              const px = type === "limit" && limitPrice ? parseFloat(limitPrice) : price;
              const val =
                mode === "notional"
                  ? spend.toFixed(2)
                  : isCrypto
                    ? (spend / px).toFixed(6)
                    : String(Math.floor(spend / px));
              const empty = mode === "qty" && !isCrypto && Math.floor(spend / px) < 1;
              return (
                <button
                  key={f}
                  className="btn"
                  disabled={empty}
                  onClick={() => setAmount(val)}
                  style={{ flex: 1, padding: "5px 0", fontSize: 10, color: "var(--ink-dim)" }}
                >
                  {f === 1 ? "MAX BP" : `${f * 100}%`}
                </button>
              );
            })}
          </div>
        )}

        {type === "limit" && (
          <input
            className="field"
            type="number"
            min="0"
            step="any"
            placeholder="LIMIT PRICE_"
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value)}
            aria-label="Limit price"
          />
        )}

        {!isCrypto && (
          <button
            className="btn"
            onClick={() => {
              const next = !bracket;
              setBracket(next);
              if (next) setMode("qty"); // brackets need share qty, not dollars
            }}
            style={{
              padding: "6px 12px",
              fontSize: 10,
              color: bracket ? "var(--accent)" : "var(--ink-faint)",
              borderColor: bracket ? "var(--accent)" : "var(--line)",
            }}
            aria-pressed={bracket}
          >
            {bracket ? "◈ BRACKET ON" : "◇ BRACKET (TP/SL)"}
          </button>
        )}

        {bracket && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <div className="label" style={{ color: "var(--up)", marginBottom: 4 }}>
                Take profit
              </div>
              <input
                className="field"
                type="number"
                min="0"
                step="any"
                placeholder={side === "buy" ? "SELL ABOVE_" : "COVER BELOW_"}
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
                aria-label="Take profit price"
              />
            </div>
            <div>
              <div className="label" style={{ color: "var(--down)", marginBottom: 4 }}>
                Stop loss
              </div>
              <input
                className="field"
                type="number"
                min="0"
                step="any"
                placeholder={side === "buy" ? "SELL BELOW_" : "COVER ABOVE_"}
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                aria-label="Stop loss price"
              />
            </div>
          </div>
        )}

        {bracket && takeProfit && stopLoss && !bracketValid && (
          <div className="label" style={{ color: "var(--amber)" }}>
            {side === "buy"
              ? "take profit must be above stop loss"
              : "short bracket: take profit below stop loss"}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
          <span className="label">
            Buying power
            {marginable && account?.multiplier && (
              <span style={{ color: "var(--accent)", marginLeft: 6 }}>
                {parseFloat(account.multiplier)}×
              </span>
            )}
            {!marginable && <span style={{ marginLeft: 6 }}>cash only</span>}
          </span>
          <span style={{ color: "var(--accent)" }}>{fmtUsd(bp)}</span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
          <span className="label">Est. {side === "buy" ? "cost" : "credit"}</span>
          <span style={{ color: "var(--ink-dim)" }}>
            {estCost != null && valid ? fmtUsd(estCost) : "—"}
            {isCrypto && estCost != null && estCost < 10 && (
              <span style={{ color: "var(--amber)", marginLeft: 8 }}>min $10</span>
            )}
          </span>
        </div>

        {side === "buy" && valid && estCost != null && bp != null && (
          estCost > bp ? (
            <div className="label" style={{ color: "var(--down)" }}>
              exceeds buying power — order will be rejected
            </div>
          ) : marginable && regtBp != null && estCost > regtBp ? (
            <div className="label" style={{ color: "var(--amber)" }}>
              ⚠ day-trade sizing — exceeds overnight (Reg-T) BP, close before market close
            </div>
          ) : cash != null && estCost > cash ? (
            <div className="label" style={{ color: "var(--amber)" }}>
              on margin — borrowing {fmtUsd(estCost - cash)}
            </div>
          ) : null
        )}

        {side === "sell" && !isCrypto && account?.shorting_enabled && (
          <div className="label" style={{ color: "var(--ink-faint)" }}>
            selling more than you hold opens a short (margin, whole shares)
          </div>
        )}

        <button
          className={`btn ${side === "buy" ? "btn-buy" : "btn-sell"}`}
          disabled={!valid || busy}
          onClick={submit}
          style={armed ? { background: side === "buy" ? "var(--up-dim)" : "var(--down-dim)" } : {}}
        >
          {busy
            ? "TRANSMITTING…"
            : armed
              ? `CONFIRM ${side} ${symbol} ⏎`
              : `${side} ${symbol}`}
        </button>

        {armed && !busy && (
          <div className="label" style={{ color: "var(--amber)", textAlign: "center" }}>
            armed — click again to transmit
          </div>
        )}

        {msg && (
          <div
            style={{
              fontSize: 11,
              padding: "6px 8px",
              border: "1px solid",
              borderColor: msg.ok ? "rgba(38,166,154,.4)" : "rgba(239,83,80,.4)",
              background: msg.ok ? "var(--up-dim)" : "var(--down-dim)",
              color: msg.ok ? "var(--up)" : "var(--down)",
            }}
            role="status"
          >
            {msg.ok ? "✓ " : "✕ "}
            {msg.text}
          </div>
        )}
      </div>
    </Panel>
  );
}
