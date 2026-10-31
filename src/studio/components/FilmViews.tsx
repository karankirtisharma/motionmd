"use client";

import { motion, useMotionValueEvent, type MotionValue } from "motion/react";
import { toast } from "sonner";
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { CHAPTERS, FORMATS, INDUSTRIES, captionsFor, type Film } from "@/studio/data/catalog";
import { EASE_OUT, PRESS } from "@/studio/lib/motion";
import { clock, usePlayer } from "@/studio/store/player";
import { usePrefs } from "@/studio/store/prefs";
import { useUI } from "@/studio/store/ui";
import {
  CaptionsIcon,
  ClockIcon,
  CubeIcon,
  DropIcon,
  ExpandIcon,
  FrameIcon,
  HeartIcon,
  MuteIcon,
  PauseIcon,
  PlayIcon,
  SoundIcon,
} from "./Icons";
import { useShortlistToggle } from "./shortlist";

/** Content enters just after the glass has started growing, and leaves before it shrinks. */
const contentIn = { opacity: 1, transition: { duration: 0.22, ease: EASE_OUT, delay: 0.12 } };
const contentOut = { opacity: 0, transition: { duration: 0.1, ease: EASE_OUT } };

// ---------- Timeline (shared by panel and theater) ----------

/**
 * The clock ticks every frame, so the scrub bar and timecode are written straight to the
 * DOM from the MotionValue. Rendering them as motion components inside the card made
 * Motion re-project the card each frame, which froze its layout animation mid-flight.
 */
function useTick(t: MotionValue<number>, write: (v: number) => void) {
  const writer = useRef(write);
  useEffect(() => {
    writer.current = write;
  });
  useEffect(() => {
    writer.current(t.get());
    return t.on("change", (v) => writer.current(v));
  }, [t]);
}

function Timeline({ chapters = false }: { chapters?: boolean }) {
  const { t, duration, seek } = usePlayer();
  const track = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const knob = useRef<HTMLSpanElement>(null);

  useTick(t, (v) => {
    const p = Math.min(1, v / duration);
    if (fill.current) fill.current.style.transform = `scaleX(${p})`;
    if (knob.current) knob.current.style.transform = `translateX(${p * 100}%)`;
    track.current?.setAttribute("aria-valuenow", String(Math.round(v)));
  });

  function scrubTo(e: RPointerEvent<HTMLDivElement>) {
    const r = track.current!.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * duration);
  }

  return (
    <div
      ref={track}
      className="timeline"
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={duration}
      // Seeded for the first paint; useTick keeps it current without re-rendering
      aria-valuenow={0}
      onPointerDown={(e) => {
        // Capture so the scrub keeps tracking outside the bar
        e.currentTarget.setPointerCapture(e.pointerId);
        scrubTo(e);
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && scrubTo(e)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.stopPropagation();
          e.preventDefault();
          seek(t.get() + (e.key === "ArrowRight" ? 5 : -5));
        }
      }}
    >
      <span className="timeline__rail" />
      <span ref={fill} className="timeline__fill" />
      <span ref={knob} className="timeline__knob-track">
        <span className="timeline__knob" />
      </span>
      {chapters &&
        CHAPTERS.map((c) => (
          <button
            key={c.label}
            type="button"
            className="timeline__chapter"
            style={{ left: `${c.at * 100}%` }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => seek(c.at * duration)}
          >
            <span className="timeline__tick" aria-hidden />
            {c.label}
          </button>
        ))}
    </div>
  );
}

function Timecode({ t, duration }: { t: MotionValue<number>; duration: number }) {
  const el = useRef<HTMLSpanElement>(null);
  useTick(t, (v) => {
    if (el.current) el.current.textContent = `${clock(v)} / ${clock(duration)}`;
  });
  return <span ref={el} className="timecode" />;
}

function PlayToggle({ className }: { className: string }) {
  const { playing, setPlaying } = usePlayer();
  return (
    <motion.button
      type="button"
      className={className}
      aria-label={playing ? "Pause" : "Play"}
      whileTap={PRESS}
      onClick={() => setPlaying(!playing)}
    >
      <span className="icon-swap" data-on={playing || undefined}>
        <PlayIcon className="icon-swap__a" />
        <PauseIcon className="icon-swap__b" />
      </span>
    </motion.button>
  );
}

// ---------- Panel (K04) ----------

export function PanelContent({ film }: { film: Film }) {
  const { t, duration, setPlaying } = usePlayer();
  const setView = useUI((s) => s.setView);
  const { has, toggle, ref } = useShortlistToggle(film);

  const chips = [
    { icon: <ClockIcon />, text: film.duration },
    { icon: <FrameIcon />, text: film.ratios.join(" · ") },
    { icon: <CubeIcon />, text: film.tags[0] },
    { icon: <DropIcon />, text: film.tags[1] },
  ];

  return (
    <motion.div className="panel" initial={{ opacity: 0 }} animate={contentIn} exit={contentOut}>
      <div className="panel__scrub">
        <PlayToggle className="panel__play" />
        <Timeline />
        <Timecode t={t} duration={duration} />
      </div>
      <h2 className="panel__title">{film.title}</h2>
      <ul className="panel__chips">
        {chips.map((c, i) => (
          <motion.li
            key={c.text}
            className="chip glass"
            initial={{ opacity: 0, transform: "translateY(6px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)", transition: { duration: 0.24, ease: EASE_OUT, delay: 0.18 + i * 0.04 } }}
          >
            {c.icon}
            <span>{c.text}</span>
          </motion.li>
        ))}
      </ul>
      <div className="panel__actions">
        <motion.button
          type="button"
          className="pill glass pill--gold"
          whileTap={PRESS}
          onClick={() => {
            setView("theater");
            setPlaying(true);
          }}
        >
          <PlayIcon className="pill__icon" />
          <span>Play film</span>
        </motion.button>
        <motion.button type="button" className="pill glass" whileTap={PRESS} onClick={() => setView("case")}>
          <span>Case study</span>
        </motion.button>
        <motion.button
          ref={ref}
          type="button"
          className="pill glass"
          aria-pressed={has}
          whileTap={PRESS}
          onClick={toggle}
        >
          <HeartIcon className="pill__icon" data-filled={has || undefined} />
          <span>{has ? "Shortlisted" : "Shortlist"}</span>
        </motion.button>
      </div>
    </motion.div>
  );
}

// ---------- Theater (K05) ----------

const IDLE_MS = 2500;

export function TheaterContent({ film }: { film: Film }) {
  const { t, duration, playing } = usePlayer();
  const captions = usePrefs((s) => s.captions);
  const sound = usePrefs((s) => s.sound);
  const setPrefs = usePrefs((s) => s.set);
  const [idle, setIdle] = useState(false);
  const [chapter, setChapter] = useState(0);
  const lines = captionsFor(film);

  // Controls step back while the film plays untouched, and return on any movement.
  // Asymmetric: they leave slowly (after 2.5s) and come back instantly.
  useEffect(() => {
    if (!playing) {
      setIdle(false);
      return;
    }
    let timer = window.setTimeout(() => setIdle(true), IDLE_MS);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), IDLE_MS);
    };
    window.addEventListener("pointermove", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [playing]);

  // Only re-render when the chapter changes, not every frame
  useMotionValueEvent(t, "change", (v) => {
    const p = v / duration;
    let c = 0;
    CHAPTERS.forEach((ch, i) => p >= ch.at && (c = i));
    if (c !== chapter) setChapter(c);
  });

  return (
    <motion.div className="theater" data-idle={idle || undefined} initial={{ opacity: 0 }} animate={contentIn} exit={contentOut}>
      <div className="theater__head">
        <p className="theater__crumb">
          {FORMATS[film.format]} <span aria-hidden>/</span> {INDUSTRIES[film.industry]}
        </p>
        <h2 className="theater__title">{film.title}</h2>
      </div>

      {captions && (
        <p className="theater__caption" aria-live="polite">
          {lines[chapter]}
        </p>
      )}

      <div className="theater__bar glass">
        <PlayToggle className="theater__play glass" />
        <Timeline chapters />
        <Timecode t={t} duration={duration} />
        <div className="theater__tools">
          <button
            type="button"
            className="tool"
            aria-pressed={captions}
            aria-label="Captions"
            onClick={() => setPrefs({ captions: !captions })}
          >
            <CaptionsIcon />
          </button>
          <button type="button" className="tool" aria-label={sound ? "Mute" : "Unmute"} onClick={() => setPrefs({ sound: !sound })}>
            <span className="icon-swap" data-on={!sound || undefined}>
              <SoundIcon className="icon-swap__a" />
              <MuteIcon className="icon-swap__b" />
            </span>
          </button>
          <button
            type="button"
            className="tool"
            aria-label="Full screen"
            onClick={async () => {
              try {
                if (document.fullscreenElement) await document.exitFullscreen();
                else {
                  const root = document.getElementById("md-studio-root");
                  if (!root?.requestFullscreen) throw new Error("Fullscreen unavailable");
                  await root.requestFullscreen();
                }
              } catch {
                toast("Full screen is not available in this browser.");
              }
            }}
          >
            <ExpandIcon />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
