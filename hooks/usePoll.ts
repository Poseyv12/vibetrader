"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Poll a JSON endpoint on an interval. Pauses while the tab is hidden.
 * Returns the last good payload plus a manual refresh trigger.
 */
export function usePoll<T>(url: string | null, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!url) return;
    try {
      const res = await fetch(url);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [url]);

  useEffect(() => {
    if (!url) return;
    setData(null);
    load();

    const start = () => {
      if (!timer.current) timer.current = setInterval(load, intervalMs);
    };
    const stop = () => {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
    const onVisibility = () => (document.hidden ? stop() : (load(), start()));

    start();
    document.addEventListener("visibilitychange", onVisibility);
    // fired after order submits so panels update without waiting a full tick
    window.addEventListener("vt:refresh", load);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("vt:refresh", load);
    };
  }, [url, intervalMs, load]);

  return { data, error, refresh: load };
}
