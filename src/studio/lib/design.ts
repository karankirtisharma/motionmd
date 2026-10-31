import type { CSSProperties } from "react";

type AnchorX = "left" | "center" | "right";
type AnchorY = "top" | "ledge";

const AX: Record<AnchorX, number> = { left: 0, center: 0.5, right: 1 };
const AY: Record<AnchorY, number> = { top: 0, ledge: 1 };

/**
 * Position an element in design px (2000 × 1125 reference frame). Use with className="at".
 * The anchors keep its distance to that edge when the viewport is wider or taller than 16:9:
 * `right` hugs the right edge, `center` stays centred, `ledge` rides the ledge line.
 */
export function at(
  x: number,
  y: number,
  w: number,
  h: number,
  ax: AnchorX = "left",
  ay: AnchorY = "top",
): CSSProperties {
  return { "--x": x, "--y": y, "--w": w, "--h": h, "--ax": AX[ax], "--ay": AY[ay] } as CSSProperties;
}

export type Box = readonly [x: number, y: number, w: number, h: number];

/** Full-page views (case study, studio, brief) sit on the reference grid, centred and riding the ledge. */
export const place = ([x, y, w, h]: Box) => at(x, y, w, h, "center", "ledge");
