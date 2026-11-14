"use client";

import { useEffect, useRef, useState } from "react";
import { isAndroidPhone } from "../lib/entryDevice";
import { usePlayer } from "@/studio/store/player";

export function requestLoungeExit() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  if (window.parent !== window) {
    window.parent.postMessage({ type: "md-studio:exit" }, window.location.origin);
  } else {
    window.location.assign("/?mode=3d");
  }
}

/** Keep the embedded browser state, but stop media work while the lounge is visible. */
export function LoungeBridge({ embedded }: { embedded: boolean }) {
  const { setPlaying } = usePlayer();
  const [screenMode, setScreenMode] = useState<"tv" | "expanded" | "legacy">("legacy");
  const [showLoungeLink, setShowLoungeLink] = useState(false);
  useEffect(() => { setShowLoungeLink(!isAndroidPhone(navigator)); }, []);
  const pausePlayback = useRef(setPlaying);
  useEffect(() => { pausePlayback.current = setPlaying; }, [setPlaying]);

  useEffect(() => {
    if (!embedded) return;
    const root = document.getElementById("md-studio-root");
    const tv = new URLSearchParams(location.search).get("display") === "tv";
    if (tv) { setScreenMode("tv"); root?.setAttribute("data-tv", ""); }
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (event.data?.type === "md-studio:display") {
        setScreenMode(event.data.expanded ? "expanded" : "tv");
        root?.toggleAttribute("data-tv", !event.data.expanded);
      } else if (event.data?.type === "md-studio:suspend") {
        pausePlayback.current(false);
        root?.setAttribute("data-suspended", "");
        root?.querySelectorAll("video, audio").forEach((media) => (media as HTMLMediaElement).pause());
      } else if (event.data?.type === "md-studio:resume") {
        root?.removeAttribute("data-suspended");
        // Resume navigation and ambient CSS only. Media stays paused until requested.
      }
    }
    window.addEventListener("message", onMessage);
    // Decode only the opening view before revealing the physical display.
    // Do not preload the catalogue or wait indefinitely for a failed image.
    let cancelled = false;
    let paintDeadline: ReturnType<typeof setTimeout>;
    const images = Array.from(root?.querySelectorAll<HTMLImageElement>(
      '.stage__plate, .card-row .card__media:not(.card__media--hero)'
    ) ?? []);
    const decoded = Promise.allSettled(images.map(image => image.decode()));
    const deadline = new Promise<void>(resolve => { paintDeadline = setTimeout(resolve, 4000); });
    void Promise.race([decoded, deadline]).then(() => {
      clearTimeout(paintDeadline);
      if (!cancelled) window.parent.postMessage({ type: "md-studio:ready" }, window.location.origin);
    });
    return () => {
      cancelled = true;
      clearTimeout(paintDeadline);
      window.removeEventListener("message", onMessage);
      root?.removeAttribute("data-suspended"); root?.removeAttribute("data-tv");
    };
  }, [embedded]);

  return embedded ? (
    <div className="studio-screen-controls">
      {screenMode === "tv" && <button type="button" className="studio-lounge-link studio-expand-link" onClick={() => window.parent.postMessage({ type: "md-studio:expand" }, location.origin)}>Expand screen</button>}
      <button type="button" className="studio-lounge-link" onClick={requestLoungeExit}>{screenMode === "tv" ? "Return to room" : screenMode === "expanded" ? "Back to TV" : "Back to the lounge"}</button>
    </div>
  ) : showLoungeLink ? (
    <a className="studio-lounge-link" href="/?mode=3d">Enter the 3D lounge</a>
  ) : null;
}
