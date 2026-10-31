// Shared by server (page.tsx parses the URL) and client (history sync) — keep it free of "use client".
import { FORMATS, INDUSTRIES } from "@/studio/data/catalog";

export type Axis = "format" | "industry";
export type View = "browse" | "expanded" | "theater" | "case" | "brief" | "studio";
export type Overlay = null | "search" | "control" | "shortlist" | "overview";

/** What the last navigation was, so cards know which way to enter and leave. */
export type Nav = { kind: "move" | "row" | "axis" | "jump"; dir: number };

export type Cursor = { axis: Axis; format: number; industry: number; view: View };

const LAST_F = FORMATS.length - 1;
const LAST_I = INDUSTRIES.length - 1;

// ---------- URL ⇄ cursor ----------

const VIEWS: View[] = ["browse", "expanded", "theater", "case", "brief", "studio"];
const DEFAULT: Cursor = { axis: "format", format: 0, industry: 2, view: "browse" };

export function cursorFromParams(p: Record<string, string | undefined>): Cursor {
  const int = (v: string | undefined, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= max + 1 ? n - 1 : fallback;
  };
  return {
    axis: p.axis === "industry" ? "industry" : "format",
    format: int(p.f, LAST_F, DEFAULT.format),
    industry: int(p.i, LAST_I, DEFAULT.industry),
    view: VIEWS.includes(p.view as View) ? (p.view as View) : DEFAULT.view,
  };
}

/** 1-based in the URL so it reads like the UI ("Film 03"). Defaults are omitted. */
export function cursorToSearch(c: Cursor, keep?: URLSearchParams): string {
  const q = new URLSearchParams(keep);
  const put = (k: string, v: string, def: string) => (v === def ? q.delete(k) : q.set(k, v));
  put("axis", c.axis, DEFAULT.axis);
  put("f", String(c.format + 1), String(DEFAULT.format + 1));
  put("i", String(c.industry + 1), String(DEFAULT.industry + 1));
  put("view", c.view, DEFAULT.view);
  const s = q.toString();
  return s ? `?${s}` : location.pathname;
}
