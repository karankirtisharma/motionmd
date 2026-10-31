"use client";

import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { FORMATS, INDUSTRIES, filmAt, filmNumber, pad2 } from "@/studio/data/catalog";
import { at } from "@/studio/lib/design";
import { EASE_OUT } from "@/studio/lib/motion";
import { useUI } from "@/studio/store/ui";
import { Glint } from "./Glint";
import { Segmented } from "./Segmented";

export function Wordmark() {
  return (
    <p className="wordmark" aria-label="motiondesign.ad">
      <span className="wordmark__light">motion</span>
      <span className="wordmark__bold">design.ad</span>
    </p>
  );
}

export function Rail() {
  const axis = useUI((s) => s.axis);
  const format = useUI((s) => s.format);
  const industry = useUI((s) => s.industry);
  const focus = useUI((s) => s.focus);
  const setAxis = useUI((s) => s.setAxis);
  const open = useUI((s) => s.railOpen);
  const instant = useUI((s) => s.railInstant);
  const setRailOpen = useUI((s) => s.setRailOpen);
  const view = useUI((s) => s.view);

  const items = axis === "format" ? FORMATS : INDUSTRIES;
  const active = axis === "format" ? format : industry;

  return (
    <>
      {/* The sliver: a 10px edge of glass that peeks while the rail is closed */}
      <button
        type="button"
        className="rail-sliver glass"
        data-hidden={open || undefined}
        aria-hidden
        tabIndex={-1}
        onClick={() => setRailOpen(true)}
      />
      <nav
        id="rail"
        className="rail glass glass--frost at"
        style={{ ...at(38, 140, 225, 810), "--count": items.length } as CSSProperties}
        data-open={open || undefined}
        data-instant={instant || undefined}
        aria-label={axis === "format" ? "Formats" : "Industries"}
        inert={!open || view !== "browse"}
      >
        <Glint />
        <Segmented
          className="rail__axis"
          label="Browse by"
          options={[
            { value: "format", label: "Format" },
            { value: "industry", label: "Industry" },
          ]}
          value={axis}
          onChange={setAxis}
        />
        <span className="rail__indicator" style={{ "--i": active } as CSSProperties} aria-hidden />
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.ul
            key={axis}
            className="rail__list"
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)", transition: { duration: 0.22, ease: EASE_OUT } }}
            exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.14, ease: EASE_OUT } }}
          >
            {items.map((name, i) => (
              <li key={name}>
                <button
                  type="button"
                  className="rail__item"
                  style={{ "--i": i } as CSSProperties}
                  aria-current={i === active || undefined}
                  onClick={() => (axis === "format" ? focus(i, industry) : focus(format, i))}
                >
                  <span className="rail__num">{pad2(i + 1)}</span>
                  <span className="rail__label">{name}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        </AnimatePresence>
      </nav>
    </>
  );
}

/** Text that changes crossfades through a light blur, so two values never overlap legibly. */
export function Swap({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`swap ${className ?? ""}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={text}
          className="swap__item"
          initial={{ opacity: 0, filter: "blur(4px)", transform: "translateY(6px)" }}
          animate={{ opacity: 1, filter: "blur(0px)", transform: "translateY(0px)", transition: { duration: 0.22, ease: EASE_OUT } }}
          exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.14, ease: EASE_OUT } }}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Digits roll on a CSS transition, so rapid key presses retarget instead of restarting. */
function Rolling({ value }: { value: string }) {
  return (
    <span className="roll" aria-label={value}>
      {value.split("").map((ch, k) =>
        /\d/.test(ch) ? (
          <span key={k} className="roll__col" aria-hidden>
            <span className="roll__strip" style={{ transform: `translateY(${-Number(ch) * 10}%)` }}>
              {"0123456789".split("").map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        ) : (
          <span key={k} aria-hidden>
            {ch}
          </span>
        ),
      )}
    </span>
  );
}

export function TitleBand() {
  const axis = useUI((s) => s.axis);
  const format = useUI((s) => s.format);
  const industry = useUI((s) => s.industry);
  const film = filmAt(format, industry);

  const title = axis === "format" ? film.title : INDUSTRIES[industry];
  const meta: ReactNode[] =
    axis === "format"
      ? [
          <Swap key="f" text={FORMATS[format]} />,
          <Swap key="i" text={INDUSTRIES[industry]} />,
          <span key="n">
            Film <Rolling value={pad2(industry + 1)} /> / {pad2(INDUSTRIES.length)}
          </span>,
          <Swap key="d" text={film.duration} />,
        ]
      : [
          <span key="l">Industry</span>,
          <span key="c">{FORMATS.length} formats</span>,
          <span key="n">
            Film <Rolling value={pad2(format + 1)} /> / {pad2(FORMATS.length)}
          </span>,
        ];

  return (
    <header className="title-band" aria-live="polite">
      <h1 className="title-band__title">
        <Swap text={title} />
      </h1>
      <p className="title-band__meta">
        {meta.map((m, i) => (
          <span key={i} style={{ display: "contents" }}>
            {i > 0 && (
              <span className="title-band__dot" aria-hidden>
                •
              </span>
            )}
            {m}
          </span>
        ))}
      </p>
    </header>
  );
}

export function Minimap() {
  const axis = useUI((s) => s.axis);
  const format = useUI((s) => s.format);
  const industry = useUI((s) => s.industry);
  const n = filmNumber(format, industry);

  return (
    <div className="minimap glass glass--frost at" style={at(1762, 757, 190, 270, "right", "ledge")}>
      <Glint />
      <div className="minimap__grid" aria-hidden>
        {FORMATS.map((_, row) =>
          INDUSTRIES.map((_, col) => (
            <span
              key={`${row}-${col}`}
              className="minimap__dot"
              data-lane={(axis === "format" ? row === format : col === industry) || undefined}
            />
          )),
        )}
        {/* One cursor element that glides between cells (its size is one cell, so % = one step) */}
        <span
          className="minimap__cursor"
          style={{ transform: `translate(${industry * 100}%, ${format * 100}%)` }}
        />
      </div>
      <p className="minimap__label">
        Film <Rolling value={pad2(n)} /> of {FORMATS.length * INDUSTRIES.length}
      </p>
    </div>
  );
}

export function HintLine({ children }: { children: ReactNode }) {
  return (
    <p className="hint">
      <span className="hint__rule" aria-hidden />
      {children}
      <span className="hint__rule" aria-hidden />
    </p>
  );
}
