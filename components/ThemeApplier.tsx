"use client";

import { useEffect } from "react";
import { applyTheme } from "@/lib/theme-client";
import { DEFAULT_THEME } from "@/lib/theme-shared";

/** Loads saved UI colors once per page load and applies them to :root. */
export function ThemeApplier() {
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        if (s?.ui) applyTheme({ ...DEFAULT_THEME, ...s.ui });
      })
      .catch(() => {});
  }, []);
  return null;
}
