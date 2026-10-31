"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { FORMATS, INDUSTRIES, caseFor, filmAt } from "@/studio/data/catalog";
import { at, place, type Box } from "@/studio/lib/design";
import { EASE_IN_OUT, EASE_OUT, PRESS } from "@/studio/lib/motion";
import { useBrief } from "@/studio/store/brief";
import { useUI } from "@/studio/store/ui";
import { ArrowLeftIcon, HeartIcon } from "./Icons";
import { useShortlistToggle } from "./shortlist";

const rise = (i: number) => ({
  initial: { opacity: 0, transform: "translateY(16px)" },
  animate: { opacity: 1, transform: "translateY(0px)", transition: { duration: 0.32, ease: EASE_OUT, delay: 0.05 + i * 0.06 } },
});

const FRAME_BOXES: Box[] = [
  [68, 493, 357, 384],
  [450, 493, 325, 384],
  [800, 493, 338, 384],
  [1162, 493, 371, 384],
];

export function CaseStudy() {
  const format = useUI((s) => s.format);
  const industry = useUI((s) => s.industry);
  const setView = useUI((s) => s.setView);
  const startBrief = useBrief((s) => s.startFrom);
  const film = filmAt(format, industry);
  const study = caseFor(film);
  const { has, toggle, ref } = useShortlistToggle(film);

  const notes = [
    { k: "The brief", v: study.brief, box: [68, 315, 487, 140] },
    { k: "The idea", v: study.idea, box: [580, 315, 475, 140] },
    { k: "The craft", v: study.craft, box: [1080, 315, 457, 140] },
  ] as const;

  return (
    <motion.section
      className="case"
      aria-label={`${film.title} case study`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.2 } }}
      exit={{ opacity: 0, transition: { duration: 0.14 } }}
    >
      <motion.button
        type="button"
        className="case__back at"
        style={at(68, 128, 260, 30, "center", "ledge")}
        whileTap={PRESS}
        onClick={() => setView("expanded")}
      >
        <ArrowLeftIcon /> Back to film
      </motion.button>

      <motion.h1 className="case__title at" style={at(68, 160, 1460, 100, "center", "ledge")} {...rise(0)}>
        {film.title}
      </motion.h1>
      <motion.p className="case__meta at" style={at(68, 264, 1460, 30, "center", "ledge")} {...rise(1)}>
        {FORMATS[film.format]} <span aria-hidden>•</span> {INDUSTRIES[film.industry]} <span aria-hidden>•</span> {film.duration}
      </motion.p>

      {notes.map((n, i) => (
        <motion.div key={n.k} className="case__note glass at" style={place(n.box)} {...rise(2 + i)}>
          <h2 className="case__kicker">{n.k}</h2>
          <p>{n.v}</p>
        </motion.div>
      ))}

      {/* Storyboard → Styleframe → Animatic → Final, revealed in order like a film developing */}
      {study.frames.map((f, i) => (
        <div key={f.label} className="case__frame glass at" style={place(FRAME_BOXES[i])}>
          <motion.span
            className="case__frame-media"
            initial={{ clipPath: "inset(0% 100% 0% 0%)" }}
            animate={{
              clipPath: "inset(0% 0% 0% 0%)",
              transition: { duration: 0.6, ease: EASE_IN_OUT, delay: 0.25 + i * 0.2 },
            }}
          >
            <Image
              src={f.src}
              alt={`${f.label} frame`}
              fill
              sizes="(orientation: portrait) 90vw, 20vw"
              loading="eager"
              className="case__img"
              data-treatment={f.treatment}
            />
          </motion.span>
          <span className="glass__tint" aria-hidden />
          <span className="glass__edge" aria-hidden />
          <span className="card__label">{f.label}</span>
        </div>
      ))}

      <motion.aside className="case__stats glass glass--frost at" style={at(1567, 315, 363, 560, "center", "ledge")} {...rise(6)}>
        <dl>
          <div>
            <dt>Duration</dt>
            <dd>{film.duration}</dd>
          </div>
          <div>
            <dt>Deliverables</dt>
            <dd>{film.ratios.join("  ·  ")}</dd>
          </div>
          <div>
            <dt>Turnaround</dt>
            <dd>{film.turnaround}</dd>
          </div>
        </dl>
        <motion.button
          type="button"
          className="pill glass pill--gold case__cta"
          whileTap={PRESS}
          onClick={() => {
            startBrief({ format: film.format, industry: film.industry, reference: film.id });
            setView("brief");
          }}
        >
          <span>Book a film like this</span>
        </motion.button>
        <motion.button ref={ref} type="button" className="pill glass case__cta" aria-pressed={has} whileTap={PRESS} onClick={toggle}>
          <HeartIcon className="pill__icon" data-filled={has || undefined} />
          <span>{has ? "On your shortlist" : "Add to shortlist"}</span>
        </motion.button>
      </motion.aside>
    </motion.section>
  );
}
