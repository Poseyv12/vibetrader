"use client";

import { useId, useState } from "react";

/**
 * Inline SVG equity sparkline. Single series — the panel title names it,
 * so no legend (dataviz: one series needs no legend box). Hover shows a
 * crosshair + value readout.
 */
export function Sparkline({
  values,
  timestamps,
  width = 320,
  height = 64,
}: {
  values: number[];
  timestamps: number[];
  width?: number;
  height?: number;
}) {
  const gradId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const pts = values.filter((v) => v != null && !Number.isNaN(v));
  if (pts.length < 2) {
    return (
      <div className="label" style={{ padding: "16px 12px" }}>
        not enough history yet
      </div>
    );
  }

  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const pad = 6;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);

  const up = pts[pts.length - 1] >= pts[0];
  const stroke = up ? "var(--up)" : "var(--down)";
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${d} L${x(pts.length - 1).toFixed(1)},${height - pad} L${x(0).toFixed(1)},${height - pad} Z`;

  const hi = hover != null ? Math.max(0, Math.min(pts.length - 1, hover)) : null;

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const frac = (e.clientX - rect.left) / rect.width;
          setHover(Math.round(frac * (pts.length - 1)));
        }}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Equity history sparkline"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradId})`} />
        <path d={d} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
        {hi != null && (
          <>
            <line
              x1={x(hi)}
              x2={x(hi)}
              y1={pad}
              y2={height - pad}
              stroke="var(--ink-faint)"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
            <circle cx={x(hi)} cy={y(pts[hi])} r="3.5" fill={stroke} stroke="var(--panel)" strokeWidth="2" />
          </>
        )}
      </svg>
      {hi != null && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 8,
            fontSize: 11,
            color: "var(--ink-dim)",
            background: "var(--panel-raised)",
            border: "1px solid var(--line)",
            padding: "2px 8px",
            pointerEvents: "none",
          }}
        >
          {timestamps[hi]
            ? new Date(timestamps[hi] * 1000).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })
            : ""}{" "}
          <span style={{ color: "var(--ink)" }}>
            {pts[hi].toLocaleString("en-US", { style: "currency", currency: "USD" })}
          </span>
        </div>
      )}
    </div>
  );
}
