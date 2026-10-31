"use client";

import { useRef } from "react";
import { toast } from "sonner";
import type { Film } from "@/studio/data/catalog";
import { usePrefs } from "@/studio/store/prefs";

export const prefersReducedMotion = () =>
  usePrefs.getState().reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The one moment of pure delight (blueprint O3): adding a film flies its thumbnail on a
 * curved path into the ♡, then the heart pops. It happens rarely, so it can take 550ms.
 * WAAPI keeps it off React and on the compositor (transform + opacity only).
 */
function flyToHeart(src: string) {
  if (prefersReducedMotion()) return;
  const from = document.querySelector(".card[data-active] .card__media-wrap")?.getBoundingClientRect();
  const heart = document.querySelector(".topbar-heart");
  const to = heart?.getBoundingClientRect();
  if (!from || !to || !heart) return;

  const size = Math.min(from.width, from.height) * 0.42;
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  Object.assign(img.style, {
    position: "fixed",
    left: `${from.left + from.width / 2 - size / 2}px`,
    top: `${from.top + from.height / 2 - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    objectFit: "cover",
    borderRadius: "18%",
    zIndex: "200",
    pointerEvents: "none",
    boxShadow: "0 0 0 1px rgb(255 225 180 / 0.5), 0 12px 30px rgb(0 0 0 / 0.5)",
  });
  document.getElementById("md-studio-root")?.appendChild(img);

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const end = (to.width * 0.5) / size;
  // Arc: the midpoint is lifted above the straight line
  img
    .animate(
      [
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 120}px) scale(0.6)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx}px, ${dy}px) scale(${end})`, opacity: 0.2 },
      ],
      { duration: 550, easing: "cubic-bezier(0.77, 0, 0.175, 1)", fill: "forwards" },
    )
    .finished.then(() => {
      img.remove();
      heart.animate([{ transform: "scale(1)" }, { transform: "scale(0.9)" }, { transform: "scale(1)" }], {
        duration: 260,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
      });
    });
}

export function useShortlistToggle(film: Film) {
  const has = usePrefs((s) => s.shortlist.includes(film.id));
  const ref = useRef<HTMLButtonElement>(null);

  function toggle() {
    const added = usePrefs.getState().toggleShortlist(film.id);
    if (added) {
      flyToHeart(film.poster);
      toast("Added to shortlist", {
        description: film.title,
        action: { label: "Undo", onClick: () => usePrefs.getState().removeFromShortlist(film.id) },
      });
    } else {
      toast("Removed from shortlist", { description: film.title });
    }
  }

  return { has, toggle, ref };
}
