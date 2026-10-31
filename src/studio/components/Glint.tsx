/**
 * Travelling light on the gold rim (see "Travelling glint" in glass.css).
 * The outer span carries the frame mask; the inner beam only rotates, so the browser
 * animates it on the compositor with no per-frame restyle or repaint.
 */
export function Glint({ capsule = false }: { capsule?: boolean }) {
  return (
    <span className="glint" data-capsule={capsule || undefined} aria-hidden>
      <span className="glint__beam" />
    </span>
  );
}
