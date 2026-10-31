"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { AnimatePresence, motion, type PanInfo } from "motion/react";
import Image from "next/image";
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Drawer } from "vaul";
import { FILMS, FORMATS, INDUSTRIES, filmAt, pad2, type Film } from "@/studio/data/catalog";
import { EASE_OUT, PRESS } from "@/studio/lib/motion";
import { useBrief } from "@/studio/store/brief";
import { Swap } from "./Chrome";
import { Glint } from "./Glint";
import { clock, usePlayer } from "@/studio/store/player";
import { LANGUAGES, usePrefs, useReduceMotion } from "@/studio/store/prefs";
import { useUI } from "@/studio/store/ui";
import {
  BriefIcon,
  CaptionsIcon,
  CheckIcon,
  CloseIcon,
  GlobeIcon,
  LinkIcon,
  MailIcon,
  MotionOffIcon,
  MuteIcon,
  SearchIcon,
  SoundIcon,
  StarIcon,
} from "./Icons";

/** Scope Radix/cmdk/vaul portals to the studio's CSS boundary. */
function useStudioPortal() {
  const [container, setContainer] = useState<HTMLElement | undefined>();
  useEffect(() => { setContainer(document.getElementById("md-studio-root") ?? undefined); }, []);
  return container;
}

export function Overlays() {
  return (
    <>
      <SearchPalette />
      <ControlCenter />
      <ShortlistDrawer />
      <Overview />
    </>
  );
}

function useOverlay(name: "search" | "control" | "shortlist" | "overview") {
  const open = useUI((s) => s.overlay === name);
  const instant = useUI((s) => s.overlayInstant);
  const setOverlay = useUI((s) => s.setOverlay);
  return { open, instant, close: () => setOverlay(null) };
}

// ---------- O01 · Search ----------

type Filter = "format" | "industry" | "short" | "vertical" | "cgi";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "format", label: "Format" },
  { key: "industry", label: "Industry" },
  { key: "short", label: "Under 30s" },
  { key: "vertical", label: "9:16" },
  { key: "cgi", label: "3D CGI" },
];

/**
 * Every typed word must appear somewhere (no scattered-letter fuzzy hits like
 * "perfume" → "App Film"). Ranked: title > format/industry > synonyms.
 */
function matchFilm(value: string, search: string, keywords: string[] = []) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  // Match on word starts, so "car" finds "Car" but not "skin-care"
  const tokens = (text: string) => text.toLowerCase().split(/[^a-z0-9:]+/).filter(Boolean);
  const title = tokens(value);
  const lead = keywords.slice(0, 3).flatMap(tokens);
  const rest = keywords.slice(3).flatMap(tokens);
  const hit = (pool: string[], w: string) => pool.some((t) => t.startsWith(w));
  let score = 0;
  for (const w of words) {
    if (hit(title, w)) score += 3;
    else if (hit(lead, w)) score += 2;
    else if (hit(rest, w)) score += 1;
    else return 0;
  }
  return score / (words.length * 3);
}

function SearchPalette() {
  const container = useStudioPortal();
  const { open, instant, close } = useOverlay("search");
  const format = useUI((s) => s.format);
  const industry = useUI((s) => s.industry);
  const focus = useUI((s) => s.focus);
  const setView = useUI((s) => s.setView);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Set<Filter>>(new Set());
  // Results stagger in on a fresh open only; typing filters instantly
  const [fresh, setFresh] = useState(true);

  useEffect(() => {
    if (open) {
      setQuery("");
      setFresh(true);
    }
  }, [open]);

  const pass = (f: Film) =>
    (!filters.has("format") || f.format === format) &&
    (!filters.has("industry") || f.industry === industry) &&
    (!filters.has("short") || f.seconds < 30) &&
    (!filters.has("vertical") || f.ratios.includes("9:16")) &&
    (!filters.has("cgi") || f.tags.includes("3D CGI"));

  const toggle = (k: Filter) =>
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <Command.Dialog
      container={container}
      open={open}
      onOpenChange={(o) => !o && close()}
      label="Search films"
      loop
      filter={matchFilm}
      overlayClassName="overlay-scrim"
      contentClassName="palette glass glass--frost"
      data-instant={instant || undefined}
    >
      <div className="palette__field glass">
        <SearchIcon />
        <Command.Input
          className="palette__input"
          placeholder="Search 50 films — try “perfume”"
          value={query}
          onValueChange={(v) => {
            setQuery(v);
            setFresh(false);
          }}
        />
        <kbd className="palette__kbd">⌘K</kbd>
      </div>
      <div className="palette__filters" role="group" aria-label="Filters">
        {FILTERS.map((f) => (
          <motion.button
            key={f.key}
            type="button"
            className="filter-chip glass"
            aria-pressed={filters.has(f.key)}
            whileTap={PRESS}
            onClick={() => {
              toggle(f.key);
              setFresh(false);
            }}
          >
            {f.key === "format" ? FORMATS[format] : f.key === "industry" ? INDUSTRIES[industry] : f.label}
          </motion.button>
        ))}
      </div>
      <Command.List className="palette__list" data-fresh={fresh || undefined}>
        <Command.Empty className="palette__empty">No films match. Try “launch”, “car” or “3D”.</Command.Empty>
        {FILMS.filter(pass).map((film, i) => (
          <Command.Item
            key={film.id}
            value={`${film.title} ${film.id}`}
            keywords={film.keywords}
            className="palette__item"
            style={{ "--i": Math.min(i, 8) } as CSSProperties}
            onSelect={() => {
              focus(film.format, film.industry);
              close();
              setView("expanded");
            }}
          >
            <span className="palette__thumb">
              <Image src={film.poster} alt="" fill sizes="120px" />
            </span>
            <span className="palette__text">
              <span className="palette__title">{film.title}</span>
              <span className="palette__sub">
                {FORMATS[film.format]} <span aria-hidden>·</span> {film.duration}
              </span>
            </span>
          </Command.Item>
        ))}
      </Command.List>
      <p className="palette__foot" aria-hidden>
        ↑ ↓ to move <span>·</span> Enter to open <span>·</span> Esc to close
      </p>
    </Command.Dialog>
  );
}

// ---------- O02 · Control center ----------

function ControlCenter() {
  const container = useStudioPortal();
  const { open, instant, close } = useOverlay("control");
  const setOverlay = useUI((s) => s.setOverlay);
  const setView = useUI((s) => s.setView);
  const format = useUI((s) => s.format);
  const industry = useUI((s) => s.industry);
  const film = filmAt(format, industry);
  const { t, duration } = usePlayer();
  const prefs = usePrefs();
  const progress = t.get() / duration;

  const tiles = [
    {
      label: prefs.sound ? "Sound On" : "Sound Off",
      icon: prefs.sound ? <SoundIcon /> : <MuteIcon />,
      on: prefs.sound,
      act: () => prefs.set({ sound: !prefs.sound }),
    },
    {
      label: prefs.captions ? "Captions On" : "Captions Off",
      icon: <CaptionsIcon />,
      on: prefs.captions,
      act: () => prefs.set({ captions: !prefs.captions }),
    },
    {
      label: "Reduce Motion",
      icon: <MotionOffIcon />,
      on: prefs.reduceMotion,
      act: () => prefs.set({ reduceMotion: !prefs.reduceMotion }),
    },
    {
      label: `Language ${prefs.language}`,
      icon: <GlobeIcon />,
      on: false,
      act: () => prefs.set({ language: LANGUAGES[(LANGUAGES.indexOf(prefs.language) + 1) % LANGUAGES.length] }),
    },
    { label: `Shortlist ${prefs.shortlist.length}`, icon: <StarIcon />, on: false, act: () => setOverlay("shortlist") },
    {
      label: "Start a Brief",
      icon: <BriefIcon />,
      on: false,
      act: () => {
        close();
        setView("brief");
      },
    },
    { label: "Contact", icon: <MailIcon />, on: false, href: "mailto:hello@motiondesign.ad" },
  ];

  return (
    <Drawer.Root open={open} onOpenChange={(o) => !o && close()} direction="bottom">
      <Drawer.Portal container={container}>
        <Drawer.Overlay className="overlay-scrim" />
        <Drawer.Content className="cc glass glass--frost" data-instant={instant || undefined} aria-describedby={undefined}>
          <Drawer.Title className="cc__title">
            <span className="cc__rule" aria-hidden />
            Control center
            <span className="cc__rule" aria-hidden />
          </Drawer.Title>
          <div className="cc__row">
            <div className="cc__preview glass">
              <span className="cc__preview-label">Now previewing</span>
              <span className="cc__preview-media">
                <Image src={film.poster} alt="" fill sizes="300px" />
              </span>
              <span className="cc__preview-bar">
                <span style={{ transform: `scaleX(${progress})` }} />
              </span>
              <span className="cc__preview-meta">
                {film.title} <span aria-hidden>·</span> {clock(t.get())} / {film.duration}
              </span>
            </div>
            {tiles.map((tile, i) => {
              const inner = (
                <>
                  <span className="cc__icon">{tile.icon}</span>
                  <span className="cc__label">{tile.label}</span>
                </>
              );
              const props = {
                className: "cc__tile glass",
                "data-on": tile.on || undefined,
                style: { "--i": i } as CSSProperties,
              };
              return tile.href ? (
                <a key={tile.label} href={tile.href} {...props}>
                  {inner}
                </a>
              ) : (
                <button key={tile.label} type="button" aria-pressed={tile.on} onClick={tile.act} {...props}>
                  {inner}
                </button>
              );
            })}
          </div>
          <p className="cc__hint" aria-hidden>
            Press C to close
          </p>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// ---------- O03 · Shortlist ----------

function ShortlistRow({ film, onRemove }: { film: Film; onRemove: () => void }) {
  const layout = !useReduceMotion();
  // Swipe right to remove: a quick flick is enough, no distance threshold needed
  function onDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x > 140 || info.velocity.x > 600) onRemove();
  }
  return (
    <motion.li
      layout={layout}
      className="sl__row glass"
      initial={{ opacity: 0, transform: "translateX(24px)" }}
      animate={{ opacity: 1, transform: "translateX(0px)", transition: { duration: 0.28, ease: EASE_OUT } }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, transition: { duration: 0.22, ease: EASE_OUT } }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0.05, right: 0.6 }}
      onDragEnd={onDragEnd}
    >
      <span className="sl__thumb">
        <Image src={film.poster} alt="" fill sizes="160px" draggable={false} />
      </span>
      <span className="sl__text">
        <span className="sl__title">{film.title}</span>
        <span className="sl__sub">
          {FORMATS[film.format]} <span aria-hidden>·</span> {film.duration}
        </span>
      </span>
      <motion.button type="button" className="sl__remove" aria-label={`Remove ${film.title}`} whileTap={PRESS} onClick={onRemove}>
        <CloseIcon />
      </motion.button>
    </motion.li>
  );
}

function ShortlistDrawer() {
  const container = useStudioPortal();
  const { open, instant, close } = useOverlay("shortlist");
  const setView = useUI((s) => s.setView);
  const ids = usePrefs((s) => s.shortlist);
  const note = usePrefs((s) => s.note);
  const setNote = usePrefs((s) => s.setNote);
  const remove = usePrefs((s) => s.removeFromShortlist);
  const startBrief = useBrief((s) => s.startFrom);
  const [copied, setCopied] = useState(false);
  const films = ids.map((id) => FILMS.find((f) => f.id === id)).filter((f): f is Film => !!f);

  async function copyLink() {
    const url = new URL(location.origin + location.pathname);
    url.searchParams.set("shortlist", ids.join(","));
    if (note) url.searchParams.set("note", note);
    await navigator.clipboard.writeText(url.toString());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Drawer.Root open={open} onOpenChange={(o) => !o && close()} direction="right">
      <Drawer.Portal container={container}>
        <Drawer.Overlay className="overlay-scrim overlay-scrim--dim" />
        <Drawer.Content className="sl glass glass--frost" data-instant={instant || undefined} aria-describedby={undefined}>
          <header className="sl__head">
            <Drawer.Title className="sl__heading">Your shortlist</Drawer.Title>
            <span className="badge sl__count">{films.length}</span>
          </header>

          {films.length === 0 ? (
            <p className="sl__empty">
              Nothing here yet. Open a film and press <strong>Shortlist</strong> to keep it for your team.
            </p>
          ) : (
            <ul className="sl__list">
              <AnimatePresence initial={false}>
                {films.map((f) => (
                  <ShortlistRow key={f.id} film={f} onRemove={() => remove(f.id)} />
                ))}
              </AnimatePresence>
            </ul>
          )}

          <textarea
            className="sl__note glass"
            placeholder="Add a note for your team"
            value={note}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="sl__actions">
            <motion.button type="button" className="pill glass" whileTap={PRESS} disabled={!films.length} onClick={copyLink}>
              <span className="icon-swap pill__icon" data-on={copied || undefined}>
                <LinkIcon className="icon-swap__a" />
                <CheckIcon className="icon-swap__b" />
              </span>
              <span>{copied ? "Copied" : "Copy share link"}</span>
            </motion.button>
            <motion.button
              type="button"
              className="pill glass pill--gold"
              whileTap={PRESS}
              onClick={() => {
                startBrief({ references: ids });
                close();
                setView("brief");
              }}
            >
              <span>{films.length ? "Start a brief with these" : "Start a brief"}</span>
            </motion.button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// ---------- Z · All 50 ----------

const PORTRAIT = "(orientation: portrait)";
function usePortrait() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(PORTRAIT);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(PORTRAIT).matches,
    () => false,
  );
}

function Overview() {
  const container = useStudioPortal();
  const { open, instant, close } = useOverlay("overview");
  const format = useUI((s) => s.format);
  const industry = useUI((s) => s.industry);
  const focus = useUI((s) => s.focus);
  // The film under the pointer (or keyboard focus); at rest, the film you came from.
  // One cell is lit and everything else steps back, so the grid has a single point of focus.
  const [hover, setHover] = useState<{ row: number; col: number; kbd: boolean } | null>(null);
  const fr = hover?.row ?? format;
  const fc = hover?.col ?? industry;
  const lit = filmAt(fr, fc);
  const tall = usePortrait();
  const rows = tall ? FORMATS : INDUSTRIES;
  const cols = tall ? INDUSTRIES : FORMATS;
  const litRow = tall ? fr : fc;
  const litCol = tall ? fc : fr;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="overlay-scrim overlay-scrim--deep" />
        <Dialog.Content
          className="overview"
          data-instant={instant || undefined}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            document.querySelector<HTMLButtonElement>(".overview__cell[aria-current]")?.focus();
          }}
        >
          {/* Title and the lit film share one line, both aligned to the grid's edges */}
          <header className="overview__head">
            <div>
              <Dialog.Title className="overview__title">All 50 films</Dialog.Title>
              <p className="overview__hint" aria-hidden>
                Click to open <span>·</span> Esc to close
              </p>
            </div>
            {/* The lit film on a glass plate. The name crossfades through a light blur (short,
                and exits faster than it enters, so it never trails the pointer); meta is instant */}
            <div className="overview__plate glass glass--frost">
              <Glint />
              <p className="overview__caption" aria-hidden>
                <Swap text={lit.title} className="overview__name" />
                <span className="overview__meta">
                  {pad2(fr + 1)} {FORMATS[fr]} <i>·</i> {INDUSTRIES[fc]} <i>·</i> {lit.duration}
                </span>
              </p>
            </div>
          </header>
          {/* The matrix takes the screen's shape: formats run across a wide screen and down a
              tall one, so cells stay close to the posters' proportions instead of thin strips */}
          <div
            className="overview__grid"
            style={{ "--cols": cols.length, "--rows": rows.length } as CSSProperties}
            onPointerLeave={() => setHover(null)}
          >
            <span />
            {cols.map((name, j) => (
              <span
                key={name}
                className="overview__col"
                data-lit={j === litCol || undefined}
                style={{ "--i": j } as CSSProperties}
              >
                <b>{pad2(j + 1)}</b>
                <span>{name}</span>
              </span>
            ))}
            {rows.map((rname, i) => (
              <div key={rname} className="overview__rowwrap">
                <span className="overview__row" data-lit={i === litRow || undefined} style={{ "--i": i } as CSSProperties}>
                  <b>{pad2(i + 1)}</b>
                  <span>{rname}</span>
                </span>
                {cols.map((_, j) => {
                  const [row, col] = tall ? [i, j] : [j, i];
                  const film = filmAt(row, col);
                  // Cells ripple out from the film you were on
                  const dist = Math.hypot(row - format, col - industry);
                  const here = row === format && col === industry;
                  return (
                    <button
                      key={film.id}
                      type="button"
                      className="overview__cell"
                      aria-current={here || undefined}
                      aria-label={film.title}
                      data-lit={(row === fr && col === fc) || undefined}
                      style={{ "--d": `${Math.min(220, dist * 22)}ms` } as CSSProperties}
                      onPointerEnter={(e) => e.pointerType === "mouse" && setHover({ row, col, kbd: false })}
                      onFocus={(e) => setHover({ row, col, kbd: e.currentTarget.matches(":focus-visible") })}
                      onClick={() => {
                        focus(row, col);
                        close();
                      }}
                    >
                      <Image src={film.poster} alt="" fill loading="eager" sizes="(orientation: portrait) 18vw, 9vw" />
                    </button>
                  );
                })}
              </div>
            ))}
            {/* A liquid-glass lens drawn in code that glides to the lit film: specular rim,
                refraction at the edge (Chromium), a soft gloss and a glint that travels the rim.
                Keyboard moves jump. */}
            <span
              className="overview__ring"
              data-instant={hover?.kbd || undefined}
              style={{ "--row": litRow, "--col": litCol } as CSSProperties}
              aria-hidden
            >
              <span className="overview__shine">
                <span className="overview__beam" />
              </span>
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
