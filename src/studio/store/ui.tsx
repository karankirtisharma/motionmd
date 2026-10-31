"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import { FORMATS, INDUSTRIES } from "@/studio/data/catalog";

import type { Axis, Cursor, Nav, Overlay, View } from "./cursor";

export type { Axis, Cursor, Nav, Overlay, View };

type State = Cursor & {
  overlay: Overlay;
  railOpen: boolean;
  /** Keyboard toggles skip the drawer animation (frequent, keyboard-initiated) */
  railInstant: boolean;
  /** Overlays opened from the keyboard appear without animation */
  overlayInstant: boolean;
  nav: Nav;
};

type Actions = {
  /** ← → : along the current axis */
  step: (dx: number) => void;
  /** ↑ ↓ : across to the next row (format axis) or column (industry axis) */
  stepRow: (dy: number) => void;
  focus: (format: number, industry: number) => void;
  setAxis: (axis: Axis) => void;
  setView: (view: View) => void;
  setOverlay: (overlay: Overlay, instant?: boolean) => void;
  setRailOpen: (open: boolean, instant?: boolean) => void;
  restore: (cursor: Cursor) => void;
};

export type UIStore = State & Actions;

const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
const LAST_F = FORMATS.length - 1;
const LAST_I = INDUSTRIES.length - 1;

function makeStore(initial: Cursor, railOpen: boolean) {
  return createStore<UIStore>()((set, get) => ({
    ...initial,
    overlay: null,
    railOpen,
    railInstant: false,
    overlayInstant: false,
    nav: { kind: "jump", dir: 0 },

    step: (dx) => {
      const s = get();
      if (s.axis === "format") {
        const industry = clamp(s.industry + dx, LAST_I);
        if (industry !== s.industry) set({ industry, nav: { kind: "move", dir: dx } });
      } else {
        const format = clamp(s.format + dx, LAST_F);
        if (format !== s.format) set({ format, nav: { kind: "move", dir: dx } });
      }
    },

    stepRow: (dy) => {
      const s = get();
      if (s.axis === "format") {
        const format = clamp(s.format + dy, LAST_F);
        if (format !== s.format) set({ format, nav: { kind: "row", dir: dy } });
      } else {
        const industry = clamp(s.industry + dy, LAST_I);
        if (industry !== s.industry) set({ industry, nav: { kind: "row", dir: dy } });
      }
    },

    focus: (format, industry) => {
      const s = get();
      if (format === s.format && industry === s.industry) return;
      // Same row as now → it's a move along the row; otherwise a row change
      const sameRow = s.axis === "format" ? format === s.format : industry === s.industry;
      const dir = sameRow
        ? Math.sign(s.axis === "format" ? industry - s.industry : format - s.format)
        : Math.sign(s.axis === "format" ? format - s.format : industry - s.industry);
      set({ format, industry, nav: { kind: sameRow ? "move" : "row", dir } });
    },

    setAxis: (axis) => {
      if (axis !== get().axis) set({ axis, nav: { kind: "axis", dir: 0 } });
    },

    setView: (view) => set({ view }),
    setOverlay: (overlay, instant = false) => set({ overlay, overlayInstant: instant }),
    setRailOpen: (railOpen, instant = false) => set({ railOpen, railInstant: instant }),
    restore: (cursor) => set({ ...cursor, nav: { kind: "jump", dir: 0 } }),
  }));
}

const Ctx = createContext<StoreApi<UIStore> | null>(null);

/** One store per mount, seeded from the URL — never shared between server requests. */
export function UIProvider({
  initial,
  railOpen = false,
  children,
}: {
  initial: Cursor;
  railOpen?: boolean;
  children: ReactNode;
}) {
  const [store] = useState(() => makeStore(initial, railOpen));
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useUI<T>(selector: (s: UIStore) => T): T {
  const store = useContext(Ctx);
  if (!store) throw new Error("useUI must be used inside <UIProvider>");
  return useStore(store, selector);
}

export function useUIStore() {
  const store = useContext(Ctx);
  if (!store) throw new Error("useUIStore must be used inside <UIProvider>");
  return store;
}
