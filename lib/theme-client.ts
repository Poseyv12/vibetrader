"use client";

import type { UiTheme } from "./theme-shared";

export function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return `rgba(34,211,238,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Push theme colors into CSS vars and tell listeners (chart) to recolor. */
export function applyTheme(ui: UiTheme) {
  const r = document.documentElement.style;
  r.setProperty("--accent", ui.accent);
  r.setProperty("--up", ui.up);
  r.setProperty("--down", ui.down);
  r.setProperty("--amber", ui.amber);
  r.setProperty("--accent-dim", hexToRgba(ui.accent, 0.12));
  r.setProperty("--up-dim", hexToRgba(ui.up, 0.14));
  r.setProperty("--down-dim", hexToRgba(ui.down, 0.14));
  window.dispatchEvent(new Event("vt:theme"));
}
