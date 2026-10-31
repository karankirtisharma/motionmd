"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useState, type CSSProperties } from "react";
import { at, place } from "@/studio/lib/design";
import { EASE_OUT, PRESS } from "@/studio/lib/motion";
import { useBrief } from "@/studio/store/brief";
import { useUI } from "@/studio/store/ui";
import { prefersReducedMotion } from "./shortlist";
import { ArrowRightIcon, CheckCircleIcon, DocIcon, FilmIcon, LayersIcon, PenIcon, PlayIcon } from "./Icons";

const PIPELINE = [
  { label: "Brief", icon: <DocIcon /> },
  { label: "Script", icon: <PenIcon /> },
  { label: "Styleframes", icon: <LayersIcon /> },
  { label: "Animatic", icon: <PlayIcon /> },
  { label: "Production", icon: <FilmIcon /> },
  { label: "Delivery", icon: <CheckCircleIcon /> },
];

const PACKAGES = [
  { title: "Launch Film", from: "From 3 weeks", format: 0, box: [1549, 203, 393, 172] },
  { title: "Social Pack", from: "From 1 week", format: 3, box: [1549, 405, 393, 175] },
  { title: "Brand Motion System", from: "From 4 weeks", format: 6, box: [1549, 606, 393, 197] },
] as const;

/**
 * Explanatory motion runs once per session: the pipeline lights node by node and the
 * stats count up. After that the Studio page just appears.
 */
function useFirstVisit(key: string) {
  // Decided after mount: the server can't see sessionStorage, and both renders must match
  const [first, setFirst] = useState(false);
  useEffect(() => {
    try {
      if (prefersReducedMotion() || sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
      setFirst(true);
    } catch {
      // Storage blocked (private mode): just skip the intro
    }
  }, [key]);
  return first;
}

function Counter({ to, play }: { to: number; play: boolean }) {
  const v = useMotionValue(to);
  const text = useTransform(v, (x) => String(Math.round(x)));
  useEffect(() => {
    if (!play) return;
    v.set(0);
    const c = animate(v, to, { duration: 1.1, ease: EASE_OUT, delay: 0.35 });
    return () => c.stop();
  }, [play, to, v]);
  return <motion.span>{text}</motion.span>;
}

export function Studio() {
  const setView = useUI((s) => s.setView);
  const startBrief = useBrief((s) => s.startFrom);
  const first = useFirstVisit("md.studio.seen");

  return (
    <motion.section
      className="studio"
      aria-label="Studio"
      // Studio sits to the right of Work, so it arrives from the right
      initial={{ opacity: 0, transform: "translateX(32px)" }}
      animate={{ opacity: 1, transform: "translateX(0px)", transition: { duration: 0.26, ease: EASE_OUT } }}
      exit={{ opacity: 0, transform: "translateX(32px)", transition: { duration: 0.16, ease: EASE_OUT } }}
      data-first={first || undefined}
    >
      <div className="studio__hero glass at" style={at(52, 190, 500, 612, "center", "ledge")}>
        <h1 className="studio__title">
          Ad films
          <br />
          that launch.
        </h1>
        <span className="studio__rule" aria-hidden />
        <p className="studio__lede">Bespoke motion design for brands, products and apps.</p>
        <dl className="studio__stats">
          {[
            [50, "Films"],
            [10, "Formats"],
            [5, "Industries"],
          ].map(([n, label]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <Counter to={n as number} play={first} />
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <ol className="pipeline at" style={at(586, 433, 896, 165, "center", "ledge")} aria-label="How we work">
        {PIPELINE.map((p, i) => (
          <li key={p.label} className="pipeline__node glass" style={{ "--i": i } as CSSProperties}>
            {i > 0 && <span className="pipeline__rail" aria-hidden />}
            <span className="pipeline__icon">{p.icon}</span>
            <span className="pipeline__label">{p.label}</span>
          </li>
        ))}
      </ol>

      {PACKAGES.map((pkg, i) => (
        <motion.button
          key={pkg.title}
          type="button"
          className="package glass at"
          style={place(pkg.box)}
          initial={{ opacity: 0, transform: "translateY(12px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)", transition: { duration: 0.3, ease: EASE_OUT, delay: 0.12 + i * 0.06 } }}
          whileTap={PRESS}
          onClick={() => {
            startBrief({ format: pkg.format });
            setView("brief");
          }}
        >
          <span className="package__title">{pkg.title}</span>
          <span className="package__from">{pkg.from}</span>
          <ArrowRightIcon className="package__arrow" />
        </motion.button>
      ))}
    </motion.section>
  );
}
