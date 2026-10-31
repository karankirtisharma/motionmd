"use client";

import { create } from "zustand";

export const LENGTHS = ["0:15", "0:30", "0:45", "1:00", "1:30+"] as const;
export const TIMELINES = ["1 week", "2–3 weeks", "4–6 weeks", "Flexible"] as const;

type Brief = {
  step: number; // 0 format · 1 industry · 2 length · 3 timeline · 4 details
  format: number | null;
  industry: number | null;
  length: (typeof LENGTHS)[number] | null;
  timeline: (typeof TIMELINES)[number] | null;
  reference: string | null;
  /** Shortlisted film ids attached from the shortlist drawer */
  references: string[];
  name: string;
  email: string;
  company: string;
  notes: string;
  dir: number;
  set: (patch: Partial<Omit<Brief, "set" | "go" | "startFrom" | "reset">>) => void;
  go: (step: number) => void;
  /** Pre-fill from a film ("Book a film like this") or a shortlist */
  startFrom: (p: { format?: number; industry?: number; reference?: string; references?: string[] }) => void;
  reset: () => void;
};

const EMPTY = {
  step: 0,
  format: null,
  industry: null,
  length: null,
  timeline: null,
  reference: null,
  references: [],
  name: "",
  email: "",
  company: "",
  notes: "",
  dir: 1,
};

export const useBrief = create<Brief>()((set, get) => ({
  ...EMPTY,
  set: (patch) => set(patch),
  go: (step) => set({ step, dir: Math.sign(step - get().step) || 1 }),
  startFrom: ({ format, industry, reference, references }) =>
    set({
      ...EMPTY,
      format: format ?? null,
      industry: industry ?? null,
      reference: reference ?? null,
      references: references ?? [],
      // Skip straight past whatever is already known
      step: format == null ? 0 : industry == null ? 1 : 2,
    }),
  reset: () => set(EMPTY),
}));
