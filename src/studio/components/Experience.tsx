"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { EASE_OUT } from "@/studio/lib/motion";
import { cursorFromParams, cursorToSearch, type Cursor } from "@/studio/store/cursor";
import { PlayerProvider, usePlayer } from "@/studio/store/player";
import { usePrefs } from "@/studio/store/prefs";
import { UIProvider, useUI, useUIStore } from "@/studio/store/ui";
import { CardRow } from "./CardRow";
import { Brief } from "./Brief";
import { CaseStudy } from "./CaseStudy";
import { Studio } from "./Studio";
import { Overlays } from "./Overlays";
import { Splash } from "./Splash";
import { HintLine, Minimap, Rail, TitleBand } from "./Chrome";
import { RailToggle, TopBar } from "./TopBar";
import { LoungeBridge, requestLoungeExit } from "./LoungeBridge";

export function Experience({
  initial,
  showSplash = false,
  railOpen = false,
  embedded = false,
}: {
  initial: Cursor;
  showSplash?: boolean;
  railOpen?: boolean;
  embedded?: boolean;
}) {
  return (
    <UIProvider initial={initial} railOpen={railOpen}>
      <PlayerProvider>
        <Motion>
          <Scene showSplash={showSplash} />
          <Keyboard embedded={embedded} />
          <LoungeBridge embedded={embedded} />
          <UrlSync />
        </Motion>
      </PlayerProvider>
    </UIProvider>
  );
}

/** OS setting or the Control Center override: transforms off, opacity kept. */
function Motion({ children }: { children: ReactNode }) {
  const reduce = usePrefs((s) => s.reduceMotion);
  useEffect(() => {
    // Rehydrate after mount (SSR-safe), then merge a shared shortlist link if there is one
    Promise.resolve(usePrefs.persist.rehydrate()).then(importSharedShortlist);
  }, []);
  useEffect(() => {
    document.getElementById("md-studio-root")?.toggleAttribute("data-reduce-motion", reduce);
  }, [reduce]);
  useEffect(() => {
    // backdrop-filter: url(#lens) is Chromium-only; elsewhere the frosted fallback stays
    const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands;
    document.getElementById("md-studio-root")?.toggleAttribute("data-lens", !!brands?.some((b) => b.brand === "Chromium"));
  }, []);
  return <MotionConfig reducedMotion={reduce ? "always" : "user"}>{children}</MotionConfig>;
}

/** ?shortlist=a,b&note=… (from "Copy share link") merges into this viewer's shortlist */
function importSharedShortlist() {
  const q = new URLSearchParams(location.search);
  const shared = q.get("shortlist");
  if (!shared) return;
  const p = usePrefs.getState();
  p.setShortlist([...new Set([...p.shortlist, ...shared.split(",").filter(Boolean)])]);
  const note = q.get("note");
  if (note && !p.note) p.setNote(note);
  q.delete("shortlist");
  q.delete("note");
  history.replaceState(null, "", q.toString() ? `?${q}` : location.pathname);
  window.dispatchEvent(new CustomEvent("open-shortlist"));
}

const HINTS: Record<string, string> = {
  expanded: "Enter to play · Esc to close",
  case: "Esc to go back",
  brief: "Esc to leave the brief",
  studio: "Esc to go back to the work",
};

function Scene({ showSplash }: { showSplash: boolean }) {
  const [splash, setSplash] = useState(showSplash);
  // After the splash, the row and title make their entrance once
  const [intro, setIntro] = useState(false);
  const done = useCallback(() => {
    setSplash(false);
    setIntro(true);
  }, []);
  const view = useUI((s) => s.view);
  const axis = useUI((s) => s.axis);
  const shortlist = usePrefs((s) => s.shortlist.length);
  const filmViews = view === "browse" || view === "expanded" || view === "theater";

  return (
    <div className="chrome" data-view={view} data-splash={splash || undefined}>
      <TopBar shortlistCount={shortlist} />
      <RailToggle />
      <Rail />

      {splash && <Splash onDone={done} />}

      <AnimatePresence>
        {view === "browse" && !splash && (
          <motion.div
            key="title"
            className="fade-layer"
            initial={intro ? { clipPath: "inset(0% 0% 100% 0%)" } : { opacity: 0 }}
            animate={{
              opacity: 1,
              clipPath: "inset(0% 0% 0% 0%)",
              transition: intro ? { duration: 0.5, ease: EASE_OUT, delay: 0.45 } : { duration: 0.22, ease: EASE_OUT, delay: 0.08 },
            }}
            exit={{ opacity: 0, transition: { duration: 0.14, ease: EASE_OUT } }}
          >
            <TitleBand />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {filmViews && !splash && (
          <motion.div
            key="row"
            className="fade-layer"
            initial={{ opacity: intro ? 1 : 0 }}
            animate={{ opacity: 1, transition: { duration: 0.22, ease: EASE_OUT } }}
            exit={{ opacity: 0, transition: { duration: 0.14, ease: EASE_OUT } }}
          >
            <CardRow intro={intro} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>{view === "case" && <CaseStudy key="case" />}</AnimatePresence>
      <AnimatePresence>{view === "brief" && <Brief key="brief" />}</AnimatePresence>
      <AnimatePresence>{view === "studio" && <Studio key="studio" />}</AnimatePresence>

      <HintLine>
        <SwapHint text={HINTS[view] ?? `← → browse · ↑ ↓ ${axis === "format" ? "format" : "industry"} · Press Z to see all 50`} />
      </HintLine>
      <Minimap />
      <Overlays />
      <Toaster
        position="bottom-center"
        toastOptions={{
          unstyled: true,
          classNames: {
            toast: "toast glass",
            title: "toast__title",
            description: "toast__description",
            actionButton: "toast__action",
          },
        }}
      />
    </div>
  );
}

function SwapHint({ text }: { text: string }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={text}
        initial={{ opacity: 0, filter: "blur(3px)" }}
        animate={{ opacity: 1, filter: "blur(0px)", transition: { duration: 0.2, ease: EASE_OUT } }}
        exit={{ opacity: 0, filter: "blur(3px)", transition: { duration: 0.12 } }}
      >
        {text}
      </motion.span>
    </AnimatePresence>
  );
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** Keyboard map (blueprint §6), per view. */
function Keyboard({ embedded }: { embedded: boolean }) {
  const store = useUIStore();
  const player = usePlayer();

  useEffect(() => {
    const openShared = () => store.getState().setOverlay("shortlist");
    window.addEventListener("open-shortlist", openShared);
    return () => window.removeEventListener("open-shortlist", openShared);
  }, [store]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Radix handles Escape in capture phase; never exit the iframe on that same key.
      if (e.defaultPrevented) return;
      // The splash owns the keyboard ("press any key") until it has gone
      if (document.querySelector("#md-studio-root .splash") || document.getElementById("md-studio-root")?.hasAttribute("data-suspended")) return;
      const s = store.getState();
      // ⌘K / Ctrl+K toggles search from anywhere — instantly (used constantly, keyboard-initiated)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.setOverlay(s.overlay === "search" ? null : "search", true);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (s.overlay) {
        // The same key closes what it opened
        const own = { control: "c", shortlist: "s", overview: "z" }[s.overlay as string];
        if (own && e.key.toLowerCase() === own) {
          e.preventDefault();
          s.setOverlay(null);
        }
        return;
      }
      const overlayKey: Record<string, "search" | "control" | "shortlist" | "overview"> = {
        "/": "search",
        c: "control",
        s: "shortlist",
        z: "overview",
      };
      const o = overlayKey[e.key.toLowerCase()];
      if (o && s.view !== "theater") {
        e.preventDefault();
        // Z is spatial explanation (where am I among the 50?), so it keeps its motion
        s.setOverlay(o, o !== "overview");
        return;
      }
      // Buttons handle their own Space/Enter
      const onButton = e.target instanceof HTMLButtonElement;

      if (s.view === "browse") {
        switch (e.key) {
          case "ArrowRight":
            s.step(1);
            break;
          case "ArrowLeft":
            s.step(-1);
            break;
          case "ArrowDown":
            s.stepRow(1);
            break;
          case "ArrowUp":
            s.stepRow(-1);
            break;
          case "f":
          case "F":
            s.setAxis("format");
            break;
          case "i":
          case "I":
            s.setAxis("industry");
            break;
          case "[":
            s.setRailOpen(!s.railOpen, true);
            break;
          case "Enter":
            if (onButton) return;
            s.setView("expanded");
            break;
          case "Escape":
            if (!s.railOpen) {
              if (!embedded) return;
              player.setPlaying(false);
              requestLoungeExit();
            } else {
              s.setRailOpen(false, true);
            }
            break;
          default:
            return;
        }
      } else if (s.view === "expanded") {
        switch (e.key) {
          case "ArrowRight":
            s.step(1);
            break;
          case "ArrowLeft":
            s.step(-1);
            break;
          case "Enter":
            if (onButton) return;
            s.setView("theater");
            player.setPlaying(true);
            break;
          case " ":
            if (onButton) return;
            player.setPlaying(!player.playing);
            break;
          case "Escape":
            s.setView("browse");
            break;
          default:
            return;
        }
      } else if (s.view === "theater") {
        switch (e.key) {
          case " ":
          case "k":
            if (onButton && e.key === " ") return;
            player.setPlaying(!player.playing);
            break;
          case "ArrowRight":
            player.seek(player.t.get() + 5);
            break;
          case "ArrowLeft":
            player.seek(player.t.get() - 5);
            break;
          case "Escape":
            s.setView("expanded");
            break;
          default:
            return;
        }
      } else if (s.view === "case") {
        if (e.key !== "Escape") return;
        s.setView("expanded");
      } else {
        if (e.key !== "Escape") return;
        s.setView("browse");
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, player, embedded]);
  return null;
}

/** Cursor moves replace history; view changes push, so Back steps out of a film. */
function UrlSync() {
  const store = useUIStore();
  useEffect(() => {
    const unsub = store.subscribe((s, prev) => {
      const changed =
        s.axis !== prev.axis || s.format !== prev.format || s.industry !== prev.industry || s.view !== prev.view;
      if (!changed) return;
      const url = cursorToSearch(s, new URLSearchParams(location.search));
      if (s.view !== prev.view) history.pushState(null, "", url);
      else history.replaceState(null, "", url);
    });
    const onPop = () => store.getState().restore(cursorFromParams(Object.fromEntries(new URLSearchParams(location.search))));
    window.addEventListener("popstate", onPop);
    return () => {
      unsub();
      window.removeEventListener("popstate", onPop);
    };
  }, [store]);
  return null;
}
