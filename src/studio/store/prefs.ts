"use client";

import { useReducedMotion } from "motion/react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const LANGUAGES = ["EN", "FR", "DE", "JA"] as const;

type Prefs = {
  shortlist: string[];
  note: string;
  sound: boolean;
  captions: boolean;
  /** Site-level override; OR-ed with the OS prefers-reduced-motion setting */
  reduceMotion: boolean;
  language: (typeof LANGUAGES)[number];
  toggleShortlist: (id: string) => boolean;
  removeFromShortlist: (id: string) => void;
  setShortlist: (ids: string[]) => void;
  setNote: (note: string) => void;
  set: (patch: Partial<Pick<Prefs, "sound" | "captions" | "reduceMotion" | "language">>) => void;
};

/**
 * Per-viewer preferences, kept in localStorage. `skipHydration` + a rehydrate() on mount
 * keeps the server render and the first client render identical (no badge flash/mismatch).
 */
export const usePrefs = create<Prefs>()(
  persist(
    (set, get) => ({
      shortlist: [],
      note: "",
      sound: true,
      captions: false,
      reduceMotion: false,
      language: "EN",
      /** Returns true when the film was added */
      toggleShortlist: (id) => {
        const has = get().shortlist.includes(id);
        set({ shortlist: has ? get().shortlist.filter((x) => x !== id) : [...get().shortlist, id] });
        return !has;
      },
      removeFromShortlist: (id) => set({ shortlist: get().shortlist.filter((x) => x !== id) }),
      setShortlist: (shortlist) => set({ shortlist }),
      setNote: (note) => set({ note }),
      set: (patch) => set(patch),
    }),
    {
      name: "motiondesign.prefs",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: ({ shortlist, note, sound, captions, reduceMotion, language }) => ({
        shortlist,
        note,
        sound,
        captions,
        reduceMotion,
        language,
      }),
    },
  ),
);

/**
 * OS setting or the Control Center override. Layout projection is switched off entirely
 * when this is true: under MotionConfig reducedMotion, Motion leaves layout projections
 * parked at their starting transform instead of jumping to the end.
 */
export function useReduceMotion() {
  const os = useReducedMotion();
  const site = usePrefs((s) => s.reduceMotion);
  return !!os || site;
}
