"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/Panel";
import { applyTheme } from "@/lib/theme-client";
import { DEFAULT_THEME, UiTheme } from "@/lib/theme-shared";

interface PublicSettings {
  alpaca: { apiKey: string; secretKey: string; fromEnv: boolean };
  llm: { url: string; model: string; embedModel: string };
  watchdog: { enabled: boolean; minImpact: "low" | "medium" | "high" };
  ui: UiTheme;
}

const PRESETS: { name: string; ui: UiTheme }[] = [
  { name: "PHOSPHOR", ui: DEFAULT_THEME },
  { name: "EMBER", ui: { accent: "#ffb74d", up: "#9ccc65", down: "#ff7043", amber: "#ffd54f" } },
  { name: "ICE", ui: { accent: "#82b1ff", up: "#4dd0e1", down: "#f06292", amber: "#ffe082" } },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}>
      <span className="label" style={{ width: 140, flexShrink: 0 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

export default function SettingsPage() {
  const [s, setS] = useState<PublicSettings | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [alpacaKey, setAlpacaKey] = useState("");
  const [alpacaSecret, setAlpacaSecret] = useState("");

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then(setS);
    fetch("/api/settings/models")
      .then((r) => r.json())
      .then((m) => Array.isArray(m) && setModels(m))
      .catch(() => {});
  }, []);

  const save = async (patch: Record<string, unknown>, section: string) => {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const next = await res.json();
    setS(next);
    setSaved(section);
    setTimeout(() => setSaved(null), 2500);
  };

  const setUi = (patch: Partial<UiTheme>) => {
    if (!s) return;
    const ui = { ...s.ui, ...patch };
    setS({ ...s, ui });
    applyTheme(ui); // live preview
  };

  if (!s) {
    return (
      <div className="label" style={{ padding: 40 }}>
        loading settings…
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 16px 60px" }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 16 }}>
        <h1 className="display" style={{ fontSize: 18, fontWeight: 700, letterSpacing: "0.28em", margin: 0 }}>
          SETTINGS<span className="cursor-blink">_</span>
        </h1>
        <span style={{ flex: 1 }} />
        <Link href="/" className="label" style={{ color: "var(--accent)", textDecoration: "none" }}>
          ◂ back to terminal
        </Link>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Panel title="API Keys" right={saved === "keys" ? <span className="label" style={{ color: "var(--up)" }}>saved ✓</span> : undefined}>
          <div style={{ padding: 12 }}>
            <div className="label" style={{ marginBottom: 8, lineHeight: 1.6 }}>
              alpaca paper keys — currently {s.alpaca.fromEnv ? "from .env.local" : "from settings"}.
              leave blank to keep unchanged.
            </div>
            <Row label="API key">
              <input className="field" placeholder={s.alpaca.apiKey || "PK…"} value={alpacaKey} onChange={(e) => setAlpacaKey(e.target.value.trim())} />
            </Row>
            <Row label="Secret key">
              <input className="field" type="password" placeholder={s.alpaca.secretKey || "secret"} value={alpacaSecret} onChange={(e) => setAlpacaSecret(e.target.value.trim())} />
            </Row>
            <button
              className="btn"
              style={{ marginTop: 8 }}
              onClick={() => {
                save({ alpaca: { ...(alpacaKey && { apiKey: alpacaKey }), ...(alpacaSecret && { secretKey: alpacaSecret }) } }, "keys");
                setAlpacaKey("");
                setAlpacaSecret("");
              }}
            >
              SAVE KEYS
            </button>
          </div>
        </Panel>

        <Panel title="Models // LM Studio" right={saved === "llm" ? <span className="label" style={{ color: "var(--up)" }}>saved ✓</span> : undefined}>
          <div style={{ padding: 12 }}>
            <Row label="Server URL">
              <input className="field" value={s.llm.url} onChange={(e) => setS({ ...s, llm: { ...s.llm, url: e.target.value } })} />
            </Row>
            <Row label="Chat model">
              <input className="field" list="models" value={s.llm.model} placeholder="auto-pick" onChange={(e) => setS({ ...s, llm: { ...s.llm, model: e.target.value } })} />
            </Row>
            <Row label="Embed model">
              <input className="field" list="models" value={s.llm.embedModel} onChange={(e) => setS({ ...s, llm: { ...s.llm, embedModel: e.target.value } })} />
            </Row>
            <datalist id="models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <button className="btn" style={{ marginTop: 8 }} onClick={() => save({ llm: s.llm }, "llm")}>
              SAVE MODELS
            </button>
          </div>
        </Panel>

        <Panel title="Theme" right={saved === "ui" ? <span className="label" style={{ color: "var(--up)" }}>saved ✓</span> : undefined}>
          <div style={{ padding: 12 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              {PRESETS.map((p) => (
                <button key={p.name} className="btn btn-ghost" style={{ border: "1px solid var(--line)", fontSize: 10, display: "inline-flex", gap: 6, alignItems: "center" }} onClick={() => setUi(p.ui)}>
                  {(["accent", "up", "down"] as const).map((k) => (
                    <span key={k} style={{ width: 8, height: 8, background: p.ui[k], display: "inline-block" }} />
                  ))}
                  {p.name}
                </button>
              ))}
            </div>
            {(
              [
                ["accent", "Accent (cyan)"],
                ["up", "Up / gains"],
                ["down", "Down / losses"],
                ["amber", "Warning / pending"],
              ] as const
            ).map(([key, label]) => (
              <Row key={key} label={label}>
                <input type="color" value={s.ui[key]} onChange={(e) => setUi({ [key]: e.target.value })} style={{ width: 44, height: 28, background: "transparent", border: "1px solid var(--line)", padding: 2, cursor: "pointer" }} />
                <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>{s.ui[key]}</span>
              </Row>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn" onClick={() => save({ ui: s.ui }, "ui")}>
                SAVE THEME
              </button>
              <button className="btn btn-ghost" style={{ border: "1px solid var(--line)" }} onClick={() => setUi(DEFAULT_THEME)}>
                RESET
              </button>
            </div>
            <div className="label" style={{ marginTop: 10 }}>
              up/down colors feed the chart — keep them distinguishable (the defaults are colorblind-validated)
            </div>
          </div>
        </Panel>

        <Panel title="News Watchdog" right={saved === "watchdog" ? <span className="label" style={{ color: "var(--up)" }}>saved ✓</span> : undefined}>
          <div style={{ padding: 12 }}>
            <Row label="Enabled">
              <button
                className="btn"
                style={{ color: s.watchdog.enabled ? "var(--up)" : "var(--ink-faint)", borderColor: s.watchdog.enabled ? "var(--up)" : "var(--line)" }}
                onClick={() => setS({ ...s, watchdog: { ...s.watchdog, enabled: !s.watchdog.enabled } })}
              >
                {s.watchdog.enabled ? "◉ ON" : "○ OFF"}
              </button>
            </Row>
            <Row label="Toast at impact">
              <div className="seg" style={{ width: 220 }}>
                {(["low", "medium", "high"] as const).map((lvl) => (
                  <button key={lvl} className={s.watchdog.minImpact === lvl ? "active" : ""} onClick={() => setS({ ...s, watchdog: { ...s.watchdog, minImpact: lvl } })}>
                    {lvl.toUpperCase()}
                  </button>
                ))}
              </div>
            </Row>
            <div className="label" style={{ margin: "6px 0 10px", lineHeight: 1.6 }}>
              streams market news, ai-triages stories touching your positions/watchlist,
              toasts at or above the chosen impact; high-impact stories are journaled
            </div>
            <button className="btn" onClick={() => save({ watchdog: s.watchdog }, "watchdog")}>
              SAVE WATCHDOG
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
