"use client";
import { useEffect } from "react";
import { useUIStore } from "@/studio/store/ui";
import { createWheelNavigation } from "@/studio/lib/wheelNavigation";

export function WheelBrowse() {
  const store = useUIStore();
  useEffect(() => {
    const root = document.getElementById("md-studio-root");
    if (!root) return;
    const navigate = createWheelNavigation();
    const onWheel = (event: WheelEvent) => {
      const state = store.getState();
      const target = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || state.overlay || state.view !== "browse" ||
          root.hasAttribute("data-suspended") || root.querySelector(".splash") ||
          target?.closest("input, textarea, select, [contenteditable=true], .rail")) return;
      const row = root.querySelector<HTMLElement>("[data-carousel-row]");
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientWidth : 1;
      // Keep native horizontal scroll-snap; map an ordinary wheel onto the same row.
      if (row && row.scrollWidth > row.clientWidth + 2 && getComputedStyle(row).overflowX === "auto") {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
          event.preventDefault();
          row.scrollBy({ left: event.deltaY * unit, behavior: "instant" });
        }
        return;
      }
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      const raw = horizontal ? event.deltaX : event.deltaY;
      if (!raw) return;
      event.preventDefault();
      const step = navigate(raw * unit, performance.now());
      if (step) state.step(step);
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [store]);
  return null;
}
