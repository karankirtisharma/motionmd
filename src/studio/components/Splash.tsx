"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { FORMATS, filmAt } from "@/studio/data/catalog";
import { at } from "@/studio/lib/design";
import { prefersReducedMotion } from "./shortlist";
import { SPLASH_COOKIE } from "./splash-cookie";

// One representative poster per format, picked for the strongest silhouette
const PICKS = [2, 3, 0, 4, 1, 0, 4, 0, 4, 0];
const ENTER_AT = 0.6; // never make the visitor wait for 100%
const RING = 2 * Math.PI * 40;


/**
 * K00 → K01 (T0). Seen once per session (session cookie, read on the server so return
 * visits never flash it). The 10 format cards fly into the rail pill on enter, which
 * teaches where the format list lives.
 */
export function Splash({ onDone }: { onDone: () => void }) {
  const total = PICKS.length + 1; // posters + fonts
  const [loaded, setLoaded] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const progress = Math.min(1, loaded / total);
  const ready = progress >= ENTER_AT;

  const tick = useCallback(() => setLoaded((n) => n + 1), []);
  useEffect(() => {
    document.fonts.ready.then(tick);
  }, [tick]);

  const enter = useCallback(() => {
    if (!ready || leaving) return;
    setLeaving(true);
    document.cookie = `${SPLASH_COOKIE}=1; path=/; SameSite=Lax`;

    const el = root.current!;
    const reduce = prefersReducedMotion();
    const pill = document.querySelector(".rail-toggle")?.getBoundingClientRect();
    const anims: Animation[] = [];

    // Wordmark and pill step back first
    el.querySelectorAll<HTMLElement>(".splash__word, .splash__meta, .splash__enter, .splash__loader").forEach((n) => {
      anims.push(
        n.animate(
          reduce
            ? [{ opacity: 1 }, { opacity: 0 }]
            : [
                { opacity: 1, transform: "scale(1)", filter: "blur(0px)" },
                { opacity: 0, transform: "scale(0.92)", filter: "blur(8px)" },
              ],
          { duration: 300, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" },
        ),
      );
    });

    // The cards file into the rail pill, 30ms apart
    el.querySelectorAll<HTMLElement>(".splash__card").forEach((card, i) => {
      const r = card.getBoundingClientRect();
      const base = getComputedStyle(card).transform;
      const from = base === "none" ? "" : base;
      const dx = pill ? pill.left + 30 - (r.left + r.width / 2) : 0;
      const dy = pill ? pill.top + pill.height / 2 - (r.top + r.height / 2) : 0;
      anims.push(
        card.animate(
          reduce
            ? [{ opacity: 1 }, { opacity: 0 }]
            : [
                { transform: `${from}`, opacity: 1 },
                { transform: `translate(${dx}px, ${dy}px) ${from} scale(0.15)`, opacity: 0.2 },
              ],
          { duration: 450, delay: 100 + i * 30, easing: "cubic-bezier(0.77, 0, 0.175, 1)", fill: "forwards" },
        ),
      );
    });

    Promise.all(anims.map((a) => a.finished)).then(onDone);
  }, [ready, leaving, onDone]);

  // Any key enters (Tab still moves focus, so keyboard users can find the button)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["Tab", "Shift", "Meta", "Control", "Alt"].includes(e.key)) return;
      e.preventDefault();
      enter();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enter]);

  return (
    <div ref={root} className="splash" data-leaving={leaving || undefined} onClick={enter} role="presentation">
      <h1 className="splash__word at" style={at(200, 190, 1600, 230, "center", "ledge")} aria-label="motiondesign.ad">
        motiondesign.ad
      </h1>
      <p className="splash__meta at" style={at(400, 440, 1200, 40, "center", "ledge")}>
        50 Films <span aria-hidden>•</span> 10 Formats <span aria-hidden>•</span> 5 Industries
      </p>

      <div className="splash__arc">
        {FORMATS.map((name, i) => {
          const d = i - 4.5; // -4.5 … 4.5 from centre
          return (
            <div
              key={name}
              className="splash__card glass"
              style={{ "--d": d, "--o": Math.abs(d) } as CSSProperties}
              aria-hidden
            >
              <Image src={filmAt(i, PICKS[i]).poster} alt="" fill sizes="12vw" priority onLoad={tick} onError={tick} />
              <span className="glass__tint" aria-hidden />
              <span className="splash__label">{name}</span>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="splash__enter pill glass at"
        style={at(835, 927, 330, 65, "center", "ledge")}
        disabled={!ready}
        onClick={(e) => {
          e.stopPropagation();
          enter();
        }}
      >
        <span className="splash__dot" aria-hidden />
        <span>{ready ? "Press any key to enter" : "Loading the reel…"}</span>
      </button>

      <div className="splash__loader at" style={at(1700, 920, 250, 96, "right", "ledge")} aria-live="polite">
        <span>Loading reel {Math.round(progress * 100)}%</span>
        <svg viewBox="0 0 96 96" aria-hidden>
          <circle cx="48" cy="48" r="40" className="splash__ring-bg" />
          <circle cx="48" cy="48" r="40" className="splash__ring" style={{ strokeDasharray: RING, strokeDashoffset: RING * (1 - progress) }} />
        </svg>
      </div>
    </div>
  );
}
