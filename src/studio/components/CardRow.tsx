"use client";

import { AnimatePresence } from "motion/react";
import { useEffect, useRef, type CSSProperties } from "react";
import { FILMS, FORMATS, INDUSTRIES } from "@/studio/data/catalog";
import { at } from "@/studio/lib/design";
import { EXPAND, FOCUS_MOVE } from "@/studio/lib/motion";
import { useUI } from "@/studio/store/ui";
import { GlassCard, type CardMode } from "./GlassCard";

// K01 geometry in design px: focused card 370×475, neighbours 225×340, 17px gaps.
const FOCUS = { w: 370, h: 475, cy: 578 };
const SIDE = { w: 225, h: 340, cy: 567 };
const GAP = 17;
const CENTER_X = 1000;

// K04: the panel; neighbours tuck 24px behind its edges
const PANEL = { x: 655, y: 155, w: 690, h: 765 };
// K05: the theater, with the next film peeking at the right edge
const THEATER = { x: 245, y: 115, w: 1470, h: 755 };
const UP_NEXT = { x: 1770, y: 175, w: 330, h: 565 };

/** x-centre of every card when `focus` is the focused index and is `focusW` wide. */
function centres(count: number, focus: number, focusW = FOCUS.w, gap = GAP) {
  return Array.from({ length: count }, (_, i) => {
    const d = i - focus;
    if (d === 0) return CENTER_X;
    const steps = Math.abs(d);
    return CENTER_X + Math.sign(d) * (focusW / 2 + gap + SIDE.w / 2 + (steps - 1) * (SIDE.w + GAP));
  });
}

// Splash → browse: rise from below like the axis rotation does
const INTRO = { kind: "axis" as const, dir: 0 };

/** Identity of a card's box, for Motion's layoutDependency */
const boxKey = (mode: CardMode, box: CSSProperties) => {
  const b = box as Record<string, number>;
  return [mode, b["--x"], b["--y"], b["--w"], b["--h"], b["--ax"]].join(",");
};

export function CardRow({ intro = false }: { intro?: boolean }) {
  const axis = useUI((s) => s.axis);
  const format = useUI((s) => s.format);
  const industry = useUI((s) => s.industry);
  const view = useUI((s) => s.view);
  const nav = useUI((s) => s.nav);
  const focusFilm = useUI((s) => s.focus);
  const setView = useUI((s) => s.setView);

  const films = axis === "format" ? FILMS.filter((f) => f.format === format) : FILMS.filter((f) => f.industry === industry);
  const focus = axis === "format" ? industry : format;
  const expanded = view === "expanded";
  const theater = view === "theater";
  const xs = expanded ? centres(films.length, focus, PANEL.w, -24) : centres(films.length, focus);

  // Opening a film is a spring (interruptible: Esc mid-flight reverses from where it is);
  // closing and moving along the row are the short tween.
  const layoutTransition = expanded || theater ? EXPAND : FOCUS_MOVE;

  useCarouselSync(films[focus].id, view === "browse", (index) => focusFilm(films[index].format, films[index].industry));

  return (
    <div className="card-row" data-carousel-row data-view={view}>
      {/* After the splash the row's first mount animates: cards rise from the ledge */}
      <AnimatePresence mode="popLayout" initial={intro} custom={nav}>
        {films.map((film, i) => {
          const d = i - focus;
          const isFocus = d === 0;
          const upNext = theater && d === 1;
          let mode: CardMode = "card";
          let box: CSSProperties;

          if (isFocus && expanded) {
            mode = "panel";
            box = at(PANEL.x, PANEL.y, PANEL.w, PANEL.h, "center", "ledge");
          } else if (isFocus && theater) {
            mode = "theater";
            box = at(THEATER.x, THEATER.y, THEATER.w, THEATER.h, "center", "ledge");
          } else if (upNext) {
            box = at(UP_NEXT.x, UP_NEXT.y, UP_NEXT.w, UP_NEXT.h, "right", "ledge");
          } else {
            const s = isFocus ? FOCUS : SIDE;
            box = at(xs[i] - s.w / 2, s.cy - s.h / 2, s.w, s.h, "center", "ledge");
          }

          const label = axis === "format" ? INDUSTRIES[film.industry] : FORMATS[film.format];
          return (
            <GlassCard
              key={film.id}
              film={film}
              label={label}
              mode={mode}
              active={isFocus}
              dim={expanded && !isFocus}
              hidden={theater && !isFocus && !upNext}
              upNext={upNext}
              nav={intro && nav.kind === "jump" ? INTRO : nav}
              layoutTransition={layoutTransition}
              layoutKey={boxKey(mode, box)}
              delay={intro && nav.kind === "jump" ? 0.15 + Math.abs(d) * 0.05 : nav.kind === "move" ? 0 : Math.abs(d) * 0.03}
              style={{ ...box, "--n": i } as CSSProperties}
              onSelect={() => {
                if (isFocus) setView("expanded");
                else focusFilm(film.format, film.industry);
              }}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/**
 * Portrait only (the row is a native scroll-snap carousel there):
 * keyboard/rail focus scrolls the card to centre; a finished swipe focuses the centred card.
 */
function useCarouselSync(focusedId: string, enabled: boolean, onSwipe: (index: number) => void) {
  const first = useRef(true);
  const swipe = useRef(onSwipe);
  useEffect(() => {
    swipe.current = onSwipe;
  });

  useEffect(() => {
    if (!enabled) return;
    const row = document.querySelector<HTMLElement>("[data-carousel-row]");
    const el = row?.querySelector<HTMLElement>(".card[data-active]");
    if (!row || !el || row.scrollWidth <= row.clientWidth) return;
    const left = el.offsetLeft - (row.clientWidth - el.clientWidth) / 2;
    if (Math.abs(row.scrollLeft - left) > 2) {
      row.scrollTo({ left, behavior: first.current ? "instant" : "smooth" });
    }
    first.current = false;
  }, [focusedId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const row = document.querySelector<HTMLElement>("[data-carousel-row]");
    if (!row) return;
    let t: number | undefined;
    const settle = () => {
      if (row.scrollWidth <= row.clientWidth) return;
      const mid = row.scrollLeft + row.clientWidth / 2;
      const cards = [...row.querySelectorAll<HTMLElement>(".card")];
      const centre = (c: HTMLElement) => Math.abs(c.offsetLeft + c.clientWidth / 2 - mid);
      const best = cards.reduce((b, c) => (centre(c) < centre(b) ? c : b), cards[0]);
      if (best && !best.hasAttribute("data-active")) swipe.current(Number(best.style.getPropertyValue("--n")));
    };
    // Debounced instead of `scrollend` so Safari behaves the same
    const onScroll = () => {
      window.clearTimeout(t);
      t = window.setTimeout(settle, 120);
    };
    row.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      row.removeEventListener("scroll", onScroll);
      window.clearTimeout(t);
    };
  }, [enabled]);
}
