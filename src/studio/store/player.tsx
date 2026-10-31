"use client";

import { useMotionValue, type MotionValue } from "motion/react";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { filmAt } from "@/studio/data/catalog";
import { useUI } from "./ui";

/**
 * Simulated playback for the focused film (there's no footage yet — the poster plays
 * with a slow push-in while this clock runs). Time is a MotionValue so the scrub bar
 * and timecode update every frame without re-rendering React.
 */
type Player = {
  t: MotionValue<number>;
  duration: number;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  seek: (seconds: number) => void;
};

const Ctx = createContext<Player | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const format = useUI((s) => s.format);
  const industry = useUI((s) => s.industry);
  const view = useUI((s) => s.view);
  const overlay = useUI((s) => s.overlay);
  const film = filmAt(format, industry);
  const duration = film.seconds;

  const t = useMotionValue(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);

  // A new film starts from the top
  useEffect(() => {
    t.set(0);
    setPlaying(false);
  }, [film.id, t]);

  // Leaving the film views stops playback
  useEffect(() => {
    if (view === "browse" || view === "brief" || view === "studio") setPlaying(false);
  }, [view]);

  // Opening an overlay pauses the film (attention goes to the overlay, and it frees the GPU)
  useEffect(() => {
    if (overlay) setPlaying(false);
  }, [overlay]);

  // Pause when the tab is hidden (edge case users never notice, which is the point)
  useEffect(() => {
    const onVis = () => document.hidden && setPlaying(false);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const next = t.get() + (now - last) / 1000;
      last = now;
      if (next >= duration) {
        t.set(duration);
        setPlaying(false);
        return;
      }
      t.set(next);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, duration, t]);

  const value = useMemo<Player>(
    () => ({
      t,
      duration,
      playing,
      setPlaying: (p) => {
        if (p && t.get() >= duration) t.set(0);
        setPlaying(p);
      },
      seek: (s) => t.set(Math.max(0, Math.min(duration, s))),
    }),
    [t, duration, playing],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlayer() {
  const p = useContext(Ctx);
  if (!p) throw new Error("usePlayer must be used inside <PlayerProvider>");
  return p;
}

export const clock = (s: number) => {
  const whole = Math.floor(s);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};
