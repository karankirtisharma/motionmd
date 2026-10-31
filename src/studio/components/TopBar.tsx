"use client";

import { FORMATS, INDUSTRIES, pad2 } from "@/studio/data/catalog";
import { at } from "@/studio/lib/design";
import { useBrief } from "@/studio/store/brief";
import { useUI } from "@/studio/store/ui";
import { Swap, Wordmark } from "./Chrome";
import { CloseIcon, GridIcon, HeartIcon, ListIcon, SearchIcon, SlidersIcon } from "./Icons";
import { Glint } from "./Glint";
import { Segmented } from "./Segmented";

export function TopBar({ shortlistCount = 0 }: { shortlistCount?: number }) {
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const setOverlay = useUI((s) => s.setOverlay);

  return (
    <>
      <Wordmark />
      <Segmented
        className="at topbar-work"
        style={at(306, 57, 200, 63)}
        label="Section"
        options={[
          { value: "work", label: "Work" },
          { value: "studio", label: "Studio" },
        ]}
        value={view === "studio" ? "studio" : "work"}
        onChange={(v) => setView(v === "studio" ? "studio" : "browse")}
      />
      <button
        type="button"
        className="icon-btn glass at topbar-grid"
        style={at(1410, 57, 63, 63, "right")}
        aria-label="See all 50 films"
        onClick={() => setOverlay("overview")}
      >
        <GridIcon />
        <Glint capsule />
      </button>
      <button
        type="button"
        className="icon-btn glass at topbar-controls"
        style={at(1495, 57, 63, 63, "right")}
        aria-label="Control center"
        onClick={() => setOverlay("control")}
      >
        <SlidersIcon />
        <Glint capsule />
      </button>
      <button
        type="button"
        className="icon-btn glass at topbar-search"
        style={at(1580, 57, 63, 63, "right")}
        aria-label="Search films"
        onClick={() => setOverlay("search")}
      >
        <SearchIcon />
        <Glint capsule />
      </button>
      <button
        type="button"
        className="icon-btn glass at topbar-heart"
        style={at(1665, 57, 63, 63, "right")}
        aria-label={`Shortlist, ${shortlistCount} films`}
        onClick={() => setOverlay("shortlist")}
      >
        <HeartIcon />
        <Glint capsule />
        {shortlistCount > 0 && <span className="badge">{shortlistCount}</span>}
      </button>
      <button
        type="button"
        className="pill glass at topbar-brief"
        style={at(1752, 57, 198, 63, "right")}
        onClick={() => {
          if (view !== "brief") useBrief.getState().reset();
          setView("brief");
        }}
      >
        Start a brief
        <Glint capsule />
      </button>
    </>
  );
}

/** The rail lives behind this pill; it names where you are so the closed rail still orients you. */
export function RailToggle() {
  const axis = useUI((s) => s.axis);
  const format = useUI((s) => s.format);
  const industry = useUI((s) => s.industry);
  const open = useUI((s) => s.railOpen);
  const setRailOpen = useUI((s) => s.setRailOpen);

  const lane = axis === "format" ? `${pad2(format + 1)}  ${FORMATS[format]}` : `${pad2(industry + 1)}  ${INDUSTRIES[industry]}`;

  return (
    <button
      type="button"
      className="pill glass at rail-toggle"
      style={at(38, 57, 252, 63)}
      aria-expanded={open}
      aria-controls="rail"
      aria-label={open ? "Close list" : `Open ${axis === "format" ? "formats" : "industries"} list`}
      onClick={() => setRailOpen(!open)}
    >
      <span className="rail-toggle__icon" data-open={open || undefined}>
        <ListIcon className="rail-toggle__list" />
        <CloseIcon className="rail-toggle__close" />
      </span>
      <Swap text={lane} className="rail-toggle__lane" />
      <Glint capsule />
    </button>
  );
}
