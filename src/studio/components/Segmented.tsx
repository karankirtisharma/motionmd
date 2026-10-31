"use client";

import type { CSSProperties } from "react";
import { Glint } from "./Glint";

type Option<T extends string> = { value: T; label: string };

/**
 * Segmented pill with the clip-path tab technique: a second, active-styled copy of the
 * labels is clipped to the selected segment, and only the clip animates. The colour
 * change lands exactly on the pill edge, which per-item colour transitions can't do.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className = "",
  style,
}: {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
  style?: CSSProperties;
}) {
  const n = options.length;
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  const clip = `inset(0 ${((n - i - 1) / n) * 100}% 0 ${(i / n) * 100}% round 999px)`;

  return (
    <div
      className={`segmented glass ${className}`}
      style={{ ...style, "--n": n } as CSSProperties}
      role="group"
      aria-label={label}
    >
      <div className="segmented__row">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className="segmented__item"
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <Glint capsule />
      {/* Light pooling under the selected segment; it slides on transform, so no edge is ever cut */}
      <span className="segmented__glow" style={{ transform: `translateX(${i * 100}%)` }} aria-hidden />
      <div className="segmented__row segmented__row--active" style={{ clipPath: clip }} aria-hidden>
        {options.map((o) => (
          <span key={o.value} className="segmented__item">
            {o.label}
          </span>
        ))}
      </div>
    </div>
  );
}
