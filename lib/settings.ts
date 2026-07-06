import fs from "fs";
import path from "path";
import { UiTheme, DEFAULT_THEME } from "./theme-shared";

/**
 * App settings persisted to data/settings.json (gitignored). Values here
 * override .env.local; env vars remain the fallback so a fresh settings
 * file changes nothing.
 */

export type LlmProvider = "lmstudio" | "openai" | "anthropic";

export interface Settings {
  alpaca: { apiKey?: string; secretKey?: string };
  llm: {
    /** which backend answers chat/agent calls — embeddings always use LM Studio */
    provider?: LlmProvider;
    url?: string;
    model?: string;
    embedModel?: string;
    openaiApiKey?: string;
    openaiModel?: string;
    anthropicApiKey?: string;
    anthropicModel?: string;
  };
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
  llmProvider: (): LlmProvider =>
    getSettings().llm.provider ||
    (process.env.LLM_PROVIDER as LlmProvider) ||
    "lmstudio",
  llmUrl: () =>
    getSettings().llm.url || process.env.LMSTUDIO_URL || "http://localhost:1234/v1",
  llmModel: () => getSettings().llm.model || process.env.LMSTUDIO_MODEL || "",
  embedModel: () =>
    getSettings().llm.embedModel ||
    process.env.LMSTUDIO_EMBED_MODEL ||
    "text-embedding-nomic-embed-text-v1.5",
  openaiKey: () => getSettings().llm.openaiApiKey || process.env.OPENAI_API_KEY || "",
  openaiModel: () => getSettings().llm.openaiModel || process.env.OPENAI_MODEL || "gpt-5",
  anthropicKey: () =>
    getSettings().llm.anthropicApiKey || process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: () =>
    getSettings().llm.anthropicModel || process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
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
      provider: resolved.llmProvider(),
      url: resolved.llmUrl(),
      model: resolved.llmModel(),
      embedModel: resolved.embedModel(),
      openaiApiKey: mask(resolved.openaiKey()),
      openaiModel: resolved.openaiModel(),
      anthropicApiKey: mask(resolved.anthropicKey()),
      anthropicModel: resolved.anthropicModel(),
    },
    watchdog: s.watchdog,
    ui: s.ui,
  };
}
