/* eslint-disable @next/next/no-img-element */

/** Dev aid: ?ref=50 overlays K01 at 50% opacity, ?ref=diff shows a difference blend. */
export function RefOverlay({ mode }: { mode?: string }) {
  if (!mode) return null;
  const diff = mode === "diff";
  const opacity = diff ? 1 : Math.min(100, Math.max(0, Number(mode) || 50)) / 100;
  return (
    <img
      className="ref-overlay"
      src="/studio/media/reference/K01.jpg"
      alt=""
      style={{ opacity, mixBlendMode: diff ? "difference" : "normal" }}
    />
  );
}
