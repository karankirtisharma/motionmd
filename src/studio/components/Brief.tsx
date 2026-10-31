"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";
import { useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { FILMS, FORMATS, INDUSTRIES, filmAt } from "@/studio/data/catalog";
import { at } from "@/studio/lib/design";
import { EASE_OUT, PRESS } from "@/studio/lib/motion";
import { LENGTHS, TIMELINES, useBrief } from "@/studio/store/brief";
import { useUI } from "@/studio/store/ui";
import { ArrowLeftIcon, ArrowRightIcon, BottleIcon, CarIcon, CheckIcon, CloudUpIcon, PhoneIcon, WineIcon } from "./Icons";

const STEPS = ["Format", "Industry", "Length", "Timeline"] as const;
const INDUSTRY_ICONS = [<CloudUpIcon key="s" />, <PhoneIcon key="t" />, <BottleIcon key="b" />, <CarIcon key="a" />, <WineIcon key="f" />];
const QUESTIONS = [
  "What kind of film is it?",
  "Which industry is it for?",
  "How long should it run?",
  "When do you need it?",
  "Where should we send the plan?",
];

/** Steps slide in the direction of travel: Next moves left, Back moves right. */
const stepVariants = {
  enter: (dir: number) => ({ opacity: 0, transform: `translateX(${dir * 24}px)`, filter: "blur(3px)" }),
  center: { opacity: 1, transform: "translateX(0px)", filter: "blur(0px)", transition: { duration: 0.28, ease: EASE_OUT } },
  exit: (dir: number) => ({ opacity: 0, transform: `translateX(${dir * -24}px)`, filter: "blur(3px)", transition: { duration: 0.16, ease: EASE_OUT } }),
};

export function Brief() {
  const b = useBrief();
  const setView = useUI((s) => s.setView);
  const [sent, setSent] = useState(false);

  const answers = [
    b.format != null ? FORMATS[b.format] : null,
    b.industry != null ? INDUSTRIES[b.industry] : null,
    b.length,
    b.timeline,
  ];
  const canNext = b.step < 4 && answers[b.step] != null;

  return (
    <motion.section
      className="brief"
      aria-label="Start a brief"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.2 } }}
      exit={{ opacity: 0, transition: { duration: 0.14 } }}
    >
      <h1 className="brief__title at" style={at(78, 160, 1000, 100, "center", "ledge")}>
        Start a brief
      </h1>

      <ol className="stepper at" style={at(80, 272, 1300, 50, "center", "ledge")}>
        {/* The line fills with scaleX up to the current step */}
        <span className="stepper__line" aria-hidden>
          <span style={{ transform: `scaleX(${Math.min(b.step, 3) / 3})` }} />
        </span>
        {STEPS.map((label, i) => {
          const done = i < b.step && answers[i] != null;
          return (
            <li key={label} className="stepper__step" data-done={done || undefined} data-current={i === b.step || undefined} style={{ "--i": i } as CSSProperties}>
              <button type="button" className="stepper__node" onClick={() => b.go(i)} aria-label={`Step ${i + 1}: ${label}`}>
                <span className="icon-swap" data-on={done || undefined}>
                  <span className="icon-swap__a stepper__num">{i + 1}</span>
                  <CheckIcon className="icon-swap__b" />
                </span>
              </button>
              <span className="stepper__label">
                {i + 1}&nbsp;&nbsp;{label}
                {answers[i] && <em> · {answers[i]}</em>}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="brief__stage at" style={at(78, 370, 1470, 470, "center", "ledge")}>
        <AnimatePresence mode="popLayout" custom={b.dir} initial={false}>
          <motion.div
            key={sent ? "sent" : b.step}
            className="brief__step"
            custom={b.dir}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <h2 className="brief__q">{sent ? "Your brief is ready." : QUESTIONS[b.step]}</h2>
            {sent ? <Sent /> : <StepBody onSent={() => setSent(true)} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <BriefMap />

      <div className="brief__nav at" style={at(1300, 930, 650, 80, "center", "ledge")}>
        {b.step > 0 && !sent && (
          <motion.button type="button" className="pill glass" whileTap={PRESS} onClick={() => b.go(b.step - 1)}>
            <ArrowLeftIcon className="pill__icon" />
            <span>Back</span>
          </motion.button>
        )}
        {b.step < 4 && (
          <motion.button
            type="button"
            className="pill glass pill--gold brief__next"
            whileTap={canNext ? PRESS : undefined}
            disabled={!canNext}
            onClick={() => b.go(b.step + 1)}
          >
            <span>Next: {b.step < 3 ? STEPS[b.step + 1] : "Details"}</span>
            <ArrowRightIcon className="pill__icon brief__arrow" />
          </motion.button>
        )}
        {sent && (
          <motion.button type="button" className="pill glass" whileTap={PRESS} onClick={() => setView("browse")}>
            <span>Back to the work</span>
          </motion.button>
        )}
      </div>
    </motion.section>
  );
}

function Option({
  selected,
  onClick,
  children,
  className = "",
  style,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <motion.button
      type="button"
      className={`option glass ${className}`}
      aria-pressed={selected}
      data-selected={selected || undefined}
      whileTap={PRESS}
      onClick={onClick}
      style={style}
    >
      <span className="glass__glow" aria-hidden />
      {children}
    </motion.button>
  );
}

function StepBody({ onSent }: { onSent: () => void }) {
  const b = useBrief();

  if (b.step === 0)
    return (
      <div className="options options--formats">
        {FORMATS.map((name, f) => (
          <Option key={name} selected={b.format === f} onClick={() => b.set({ format: f })} style={{ "--i": f } as CSSProperties}>
            <span className="option__media">
              <Image src={filmAt(f, b.industry ?? 2).poster} alt="" fill sizes="(orientation: portrait) 45vw, 12vw" loading="eager" />
            </span>
            <span className="glass__tint" aria-hidden />
            <span className="option__label">{name}</span>
          </Option>
        ))}
      </div>
    );

  if (b.step === 1)
    return (
      <div className="options options--industries">
        {INDUSTRIES.map((name, i) => (
          <Option key={name} selected={b.industry === i} onClick={() => b.set({ industry: i })} style={{ "--i": i } as CSSProperties}>
            <span className="option__media">
              <Image src={filmAt(b.format ?? 0, i).poster} alt="" fill sizes="(orientation: portrait) 45vw, 18vw" loading="eager" />
            </span>
            <span className="glass__tint" aria-hidden />
            <span className="option__icon">{INDUSTRY_ICONS[i]}</span>
            <span className="option__label">{name}</span>
          </Option>
        ))}
      </div>
    );

  if (b.step === 2)
    return (
      <div className="options options--chips">
        {LENGTHS.map((l, i) => (
          <Option key={l} selected={b.length === l} onClick={() => b.set({ length: l })} style={{ "--i": i } as CSSProperties}>
            <span className="option__big">{l}</span>
            <span className="option__small">{["Social cut", "Spot", "Launch", "Hero film", "Long form"][i]}</span>
          </Option>
        ))}
      </div>
    );

  if (b.step === 3)
    return (
      <div className="options options--chips">
        {TIMELINES.map((t, i) => (
          <Option key={t} selected={b.timeline === t} onClick={() => b.set({ timeline: t })} style={{ "--i": i } as CSSProperties}>
            <span className="option__big">{t}</span>
            <span className="option__small">{["Rush", "Typical launch", "Brand systems", "We'll plan it together"][i]}</span>
          </Option>
        ))}
      </div>
    );

  return <Details onSent={onSent} />;
}

function Details({ onSent }: { onSent: () => void }) {
  const b = useBrief();
  const refs = [b.reference, ...b.references].filter((x): x is string => !!x);
  const refTitles = [...new Set(refs)].map((id) => FILMS.find((f) => f.id === id)?.title).filter(Boolean);

  function submit(e: FormEvent) {
    e.preventDefault();
    // No backend yet: hand the composed brief to the visitor's mail app
    const lines = [
      `Name: ${b.name}`,
      `Company: ${b.company}`,
      `Email: ${b.email}`,
      "",
      `Format: ${b.format != null ? FORMATS[b.format] : "—"}`,
      `Industry: ${b.industry != null ? INDUSTRIES[b.industry] : "—"}`,
      `Length: ${b.length ?? "—"}`,
      `Timeline: ${b.timeline ?? "—"}`,
      refTitles.length ? `References: ${refTitles.join(", ")}` : "",
      "",
      b.notes,
    ];
    location.href = `mailto:hello@motiondesign.ad?subject=${encodeURIComponent(`Brief — ${b.company || b.name}`)}&body=${encodeURIComponent(lines.join("\n"))}`;
    onSent();
  }

  return (
    <form className="details" onSubmit={submit}>
      <label className="field">
        <span>Name</span>
        <input className="glass" required value={b.name} onChange={(e) => b.set({ name: e.target.value })} autoComplete="name" />
      </label>
      <label className="field">
        <span>Work email</span>
        <input className="glass" type="email" required value={b.email} onChange={(e) => b.set({ email: e.target.value })} autoComplete="email" />
      </label>
      <label className="field">
        <span>Company</span>
        <input className="glass" value={b.company} onChange={(e) => b.set({ company: e.target.value })} autoComplete="organization" />
      </label>
      <label className="field field--wide">
        <span>Anything else we should know?</span>
        <textarea className="glass" rows={3} value={b.notes} onChange={(e) => b.set({ notes: e.target.value })} />
      </label>
      {refTitles.length > 0 && <p className="details__refs">References attached: {refTitles.join(" · ")}</p>}
      <motion.button type="submit" className="pill glass pill--gold details__send" whileTap={PRESS}>
        <span>Send brief</span>
        <ArrowRightIcon className="pill__icon" />
      </motion.button>
    </form>
  );
}

function Sent() {
  return (
    <p className="brief__sent">
      Your mail app should have opened with the brief filled in. We reply within one working day with a plan, a timeline and
      a fixed quote.
    </p>
  );
}

/** "Your film lives here": the same 10×5 matrix as the minimap, narrowing with each answer. */
function BriefMap() {
  const { format, industry } = useBrief();
  const reference = format != null && industry != null ? filmAt(format, industry) : null;

  return (
    <aside className="brief-map glass glass--frost at" style={at(1620, 185, 325, 595, "center", "ledge")}>
      <div className="brief-map__grid" aria-hidden>
        {FORMATS.map((_, row) =>
          INDUSTRIES.map((_, col) => (
            <span
              key={`${row}-${col}`}
              className="minimap__dot"
              data-lane={((format == null || row === format) && (industry == null || col === industry) && (format != null || industry != null)) || undefined}
              data-hit={(row === format && col === industry) || undefined}
            />
          )),
        )}
      </div>
      <p className="brief-map__label">Your film lives here</p>
      <AnimatePresence mode="popLayout">
        {reference && (
          <motion.div
            key={reference.id}
            className="brief-map__ref"
            initial={{ opacity: 0, transform: "translateY(10px)", filter: "blur(4px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)", filter: "blur(0px)", transition: { duration: 0.3, ease: EASE_OUT } }}
            exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.14 } }}
          >
            <span className="brief-map__thumb">
              <Image src={reference.poster} alt="" fill sizes="240px" loading="eager" />
            </span>
            <span className="brief-map__caption">
              Closest reference ·<br />
              {reference.title}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
}
