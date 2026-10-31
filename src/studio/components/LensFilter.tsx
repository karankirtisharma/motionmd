/**
 * Liquid-glass lensing for the clear glass (rail, minimap, brief map, top-bar capsules).
 *
 * A displacement map pushes samples outward inside the rim band and leaves the middle
 * untouched, so what's behind the pane bends only at its rolled edge, like the K03
 * rail close-up, while the wood stays sharp through the centre. The map is two
 * gradients, red for x and green for y, neutral (128) in the middle and ramping to
 * 0 / 255 at the edges. They're added with feComposite so each channel carries only
 * its own axis.
 *
 * The map is stretched over each element, so one ramp can't give every shape the same
 * band thickness. Each variant's ramps are sized to its shape's ~7-design-px tube.
 *
 * Used through `backdrop-filter: url(#lens-…)`, which only Chromium supports; the
 * `data-lens` flag on <html> gates it and other browsers keep the frosted fallback.
 */

const VARIANTS = {
  // id: [x ramp, y ramp, max shift in px]
  "lens-panel": [0.06, 0.018, 16], // rail: 225 × 810
  "lens-tile": [0.07, 0.05, 14], // minimap, brief map
  "lens-pill": [0.035, 0.16, 10], // capsules ~300 × 63
} as const;

const hex = (n: number) => n.toString(16).padStart(2, "0");
const uri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function ramp(axis: "x" | "y", edge: number) {
  const c = (v: number) => (axis === "x" ? `#${hex(v)}0000` : `#00${hex(v)}00`);
  return uri(
    `<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' preserveAspectRatio='none'>` +
      `<linearGradient id='g' x2='${axis === "x" ? 1 : 0}' y2='${axis === "y" ? 1 : 0}'>` +
      `<stop offset='0' stop-color='${c(0)}'/><stop offset='${edge}' stop-color='${c(128)}'/>` +
      `<stop offset='${1 - edge}' stop-color='${c(128)}'/><stop offset='1' stop-color='${c(255)}'/>` +
      `</linearGradient><rect width='100' height='100' fill='url(#g)'/></svg>`,
  );
}

export function LensFilter() {
  return (
    <svg width="0" height="0" aria-hidden style={{ position: "absolute" }}>
      {Object.entries(VARIANTS).map(([id, [ex, ey, scale]]) => (
        <filter key={id} id={id} x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
          <feImage href={ramp("x", ex)} preserveAspectRatio="none" result="mx" />
          <feImage href={ramp("y", ey)} preserveAspectRatio="none" result="my" />
          <feComposite in="mx" in2="my" operator="arithmetic" k2="1" k3="1" result="map" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale={scale * 2} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      ))}
    </svg>
  );
}
