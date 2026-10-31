"use client";

import Image from "next/image";
import {
  AnimatePresence,
  motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
  type Transition,
  type Variants,
} from "motion/react";
import { useEffect, type CSSProperties, type PointerEvent } from "react";
import { heroFor, type Film } from "@/studio/data/catalog";
import { EASE_OUT, FOCUS_MOVE, PRESS } from "@/studio/lib/motion";
import { usePlayer } from "@/studio/store/player";
import { useReduceMotion } from "@/studio/store/prefs";
import type { Nav } from "@/studio/store/ui";
import { PanelContent, TheaterContent } from "./FilmViews";
import { Glint } from "./Glint";

export type CardMode = "card" | "panel" | "theater";

type Props = {
  film: Film;
  label: string;
  mode?: CardMode;
  active?: boolean;
  /** Pushed behind the expanded panel */
  dim?: boolean;
  /** Not part of the current view (theater hides the row) */
  hidden?: boolean;
  /** Theater peeks the next film at the edge */
  upNext?: boolean;
  style?: CSSProperties;
  /** Entry stagger, seconds */
  delay?: number;
  nav: Nav;
  layoutTransition?: Transition;
  /**
   * Changes only when this card's box or mode changes. Motion then re-measures only on a
   * real layout change, so unrelated re-renders (playback state, chapters) can't halt a
   * layout animation mid-flight.
   */
  layoutKey: string;
  onSelect?: () => void;
};

// Specular rests at the top-left, where the room light comes from.
const REST = { x: -0.22, y: -0.28 };
const SPRING = { stiffness: 150, damping: 20 };

type Custom = Nav & { delay?: number };

// Rows are vertical in the matrix, so row changes move vertically (T2).
// Axis rotation (T3): row-only cards fade back, column cards rise from the ledge.
// Opacity + y only: these cards hold an image and a backdrop-filtered bevel, so a
// blur here would re-rasterise 5–10 of them every frame of a row change.
const variants: Variants = {
  initial: ({ kind, dir }: Custom) => ({
    opacity: 0,
    y: kind === "axis" ? 48 : kind === "row" ? dir * 28 : 0,
  }),
  enter: ({ delay = 0 }: Custom) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.26, ease: EASE_OUT, delay },
  }),
  exit: ({ kind, dir }: Custom) => ({
    opacity: 0,
    y: kind === "row" ? -dir * 28 : 0,
    transition: { duration: 0.16, ease: EASE_OUT },
  }),
};

export function GlassCard({
  film,
  label,
  mode = "card",
  active = false,
  dim = false,
  hidden = false,
  upNext = false,
  style,
  delay = 0,
  nav,
  layoutTransition = FOCUS_MOVE,
  layoutKey,
  onSelect,
}: Props) {
  const { playing } = usePlayer();
  const layout = !useReduceMotion();
  const mx = useMotionValue(REST.x * 50);
  const my = useMotionValue(REST.y * 50);
  const sx = useSpring(mx, SPRING);
  const sy = useSpring(my, SPRING);
  const transform = useMotionTemplate`translate3d(${sx}%, ${sy}%, 0)`;
  const tiltX = useSpring(0, SPRING);
  const tiltY = useSpring(0, SPRING);
  const canTilt = layout && mode === "card" && !hidden && !dim && !upNext;

  // Keep hover rotation separate from the outer card's layout projection.
  // Clear it immediately when opening a film or changing the browse selection.
  useEffect(() => {
    tiltX.jump(0);
    tiltY.jump(0);
  }, [canTilt, layoutKey, tiltX, tiltY]);

  // Values are % of the 200%-sized spec layer, so they stay resolution-independent.
  function track(e: PointerEvent<HTMLDivElement>) {
    if (!canTilt || e.pointerType !== "mouse" || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = Math.max(-0.5, Math.min(0.5, (e.clientX - r.left) / r.width - 0.5));
    const y = Math.max(-0.5, Math.min(0.5, (e.clientY - r.top) / r.height - 0.5));
    mx.set(x * 50);
    my.set(y * 50);
    tiltX.set(-y * 6);
    tiltY.set(x * 8);
  }

  function rest() {
    tiltX.set(0);
    tiltY.set(0);
    mx.set(REST.x * 50);
    my.set(REST.y * 50);
  }

  const hero = heroFor(film);
  const wide = mode !== "card";

  return (
    <motion.div
      className="card at"
      style={style}
      data-active={active || undefined}
      data-mode={mode}
      data-dim={dim || undefined}
      data-hidden={hidden || undefined}
      data-upnext={upNext || undefined}
      data-playing={(active && wide && playing) || undefined}
      layout={layout}
      layoutDependency={layoutKey}
      custom={{ ...nav, delay }}
      variants={variants}
      initial="initial"
      animate="enter"
      exit="exit"
      transition={{ layout: layoutTransition }}
      whileTap={mode === "card" && !hidden ? PRESS : undefined}
      onPointerMove={track}
      onPointerLeave={rest}
      onPointerEnter={track}
    >
      <span className="glass__glow" aria-hidden />
      <motion.span
        className="glass"
        style={{
          transformPerspective: 900,
          rotateX: canTilt ? tiltX : 0,
          rotateY: canTilt ? tiltY : 0,
        }}
      >
        <motion.span
          className="card__media-wrap"
          layout={layout}
          layoutDependency={layoutKey}
          transition={{ layout: layoutTransition }}
        >
          <Image
            className="card__media"
            src={film.poster}
            alt=""
            fill
            sizes={active ? "(orientation: portrait) 60vw, 20vw" : "(orientation: portrait) 40vw, 12vw"}
            priority={active}
          />
          {/* A dedicated wide frame crossfades in once the card opens up */}
          {active && hero !== film.poster && (
            <Image className="card__media card__media--hero" src={hero} alt="" fill sizes="80vw" data-show={wide || undefined} />
          )}
        </motion.span>
        <span className="glass__tint" aria-hidden />
        {/* The bevel band of the slab: the picture seen through thick glass edge */}
        <span className="glass__edge" aria-hidden />
        <Glint />
        <motion.span className="glass__spec" aria-hidden style={{ transform }} />

        {mode === "card" && (
          <>
            <motion.span
              className="card__label"
              layout={layout && "position"}
              layoutDependency={layoutKey}
              transition={{ layout: layoutTransition }}
            >
              {upNext ? (
                <>
                  <span className="card__kicker">Up next</span>
                  {film.title}
                </>
              ) : (
                label
              )}
            </motion.span>
            <button
              type="button"
              className="card__hit"
              aria-label={active ? `Open ${film.title}` : label}
              tabIndex={hidden ? -1 : 0}
              onClick={onSelect}
            />
          </>
        )}

        <AnimatePresence>
          {mode === "panel" && <PanelContent key="panel" film={film} />}
          {mode === "theater" && <TheaterContent key="theater" film={film} />}
        </AnimatePresence>
      </motion.span>
    </motion.div>
  );
}
