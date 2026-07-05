import fs from "fs";
import path from "path";
import { UiTheme, DEFAULT_THEME } from "./theme-shared";

/**
 * App settings persisted to data/settings.json (gitignored). Values here
 * override .env.local; env vars remain the fallback so a fresh settings
 * file changes nothing.
 */

export interface Settings {
  alpaca: { apiKey?: string; secretKey?: string };
  llm: { url?: string; model?: string; embedModel?: string };
  watchdog: { enabled: boolean; minImpact: "low" | "medium" | "high" };
  ui: UiTheme;
}

const DEFAULTS: Settings = {
  alpaca: {},
  llm: {},
  watchdog: { enabled: true, minImpact: "medium" },
  ui: { ...DEFAULT_THEME },
};

const FILE = path.join(process.cwd(), "data", "settings.json");
const g = globalThis as { __vtSettings?: Settings };

export function getSettings(): Settings {
  if (g.__vtSettings) return g.__vtSettings;
  let loaded: Partial<Settings> = {};
  try {
    loaded = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {}
  g.__vtSettings = {
    alpaca: { ...DEFAULTS.alpaca, ...loaded.alpaca },
    llm: { ...DEFAULTS.llm, ...loaded.llm },
    watchdog: { ...DEFAULTS.watchdog, ...loaded.watchdog },
    ui: { ...DEFAULTS.ui, ...loaded.ui },
  };
  return g.__vtSettings;
}

export function updateSettings(patch: {
  alpaca?: Partial<Settings["alpaca"]>;
  llm?: Partial<Settings["llm"]>;
  watchdog?: Partial<Settings["watchdog"]>;
  ui?: Partial<UiTheme>;
}): Settings {
  const cur = getSettings();
  const next: Settings = {
    alpaca: { ...cur.alpaca, ...patch.alpaca },
    llm: { ...cur.llm, ...patch.llm },
    watchdog: { ...cur.watchdog, ...patch.watchdog },
    ui: { ...cur.ui, ...patch.ui },
  };
  g.__vtSettings = next;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}

/** Resolved credentials/endpoints: settings first, env fallback. */
export const resolved = {
  alpacaKey: () => getSettings().alpaca.apiKey || process.env.ALPACA_API_KEY || "",
  alpacaSecret: () => getSettings().alpaca.secretKey || process.env.ALPACA_SECRET_KEY || "",
  llmUrl: () =>
    getSettings().llm.url || process.env.LMSTUDIO_URL || "http://localhost:1234/v1",
  llmModel: () => getSettings().llm.model || process.env.LMSTUDIO_MODEL || "",
  embedModel: () =>
    getSettings().llm.embedModel ||
    process.env.LMSTUDIO_EMBED_MODEL ||
    "text-embedding-nomic-embed-text-v1.5",
};

const mask = (v?: string) => (v && v.length > 4 ? `••••${v.slice(-4)}` : v ? "••••" : "");

/** Client-safe view: secrets masked, env-derived values shown as effective. */
export function publicSettings() {
  const s = getSettings();
  return {
    alpaca: {
      apiKey: mask(resolved.alpacaKey()),
      secretKey: mask(resolved.alpacaSecret()),
      fromEnv: !s.alpaca.apiKey,
    },
    llm: {
      url: resolved.llmUrl(),
      model: resolved.llmModel(),
      embedModel: resolved.embedModel(),
    },
    watchdog: s.watchdog,
    ui: s.ui,
  };
}
