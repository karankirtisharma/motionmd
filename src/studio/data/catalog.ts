// 50 films = 10 formats (rows) × 5 industries (columns). See blueprint §1.

export const FORMATS = [
  "Product Launch",
  "Brand Film",
  "Explainer",
  "Social Ads",
  "CGI Product",
  "App & UI",
  "Motion Identity",
  "Event & Keynote",
  "Data Stories",
  "Title Design",
] as const;

export const INDUSTRIES = [
  "SaaS",
  "Consumer Tech",
  "Beauty & Fragrance",
  "Automotive",
  "Food & Beverage",
] as const;

const FORMAT_SLUGS = [
  "product-launch",
  "brand-film",
  "explainer",
  "social-ads",
  "cgi-product",
  "app-ui",
  "motion-identity",
  "event-keynote",
  "data-stories",
  "title-design",
];
const INDUSTRY_SLUGS = ["saas", "consumer-tech", "beauty", "automotive", "food-beverage"];

// Fictional client brands, one per industry (AURELLE and SOLA come from the reference frames)
const BRANDS = ["Northlane", "Kairo", "AURELLE", "Vanta", "SOLA"];

const FORMAT_NOUN = [
  "Launch Film",
  "Brand Film",
  "Explainer",
  "Social Ad",
  "CGI Film",
  "App Film",
  "Identity",
  "Keynote Opener",
  "Data Story",
  "Title Sequence",
];

// Seconds, per format; industries nudge it so rows don't read as identical
const BASE_SECONDS = [45, 60, 90, 15, 30, 40, 10, 50, 70, 40];
const NUDGE = [-5, 0, 0, 5, 0];

const RATIOS: string[][] = [
  ["16:9", "9:16", "1:1"],
  ["16:9", "2.39:1"],
  ["16:9", "1:1"],
  ["9:16", "1:1"],
  ["16:9", "9:16", "1:1"],
  ["9:16", "16:9"],
  ["16:9", "1:1"],
  ["16:9"],
  ["16:9", "9:16"],
  ["2.39:1", "16:9"],
];

const TAGS: string[][] = [
  ["3D CGI", "Liquid simulation"],
  ["Live action", "Colour grade"],
  ["2D motion", "Voiceover"],
  ["Kinetic type", "Sound design"],
  ["3D CGI", "Macro"],
  ["UI animation", "Device renders"],
  ["Logo animation", "Sonic logo"],
  ["Stage visuals", "Projection"],
  ["Data viz", "2D motion"],
  ["Typography", "Compositing"],
];

const TURNAROUND = ["3 weeks", "4 weeks", "3 weeks", "1 week", "2 weeks", "2 weeks", "2 weeks", "3 weeks", "3 weeks", "2 weeks"];

// Words people actually type ("perfume") mapped onto the catalogue's vocabulary
const INDUSTRY_WORDS = [
  ["software", "b2b", "cloud", "dashboard", "startup"],
  ["gadget", "device", "watch", "earbuds", "hardware", "phone"],
  ["perfume", "fragrance", "scent", "cosmetics", "skincare", "luxury"],
  ["car", "auto", "vehicle", "ev", "motor"],
  ["drink", "food", "soda", "restaurant", "cocktail", "snack"],
];
const FORMAT_WORDS = [
  ["launch", "reveal", "hero"],
  ["brand", "manifesto", "story"],
  ["explainer", "how it works", "tutorial"],
  ["social", "reels", "tiktok", "vertical", "ad"],
  ["3d", "render", "cgi", "macro"],
  ["app", "ui", "interface", "product demo"],
  ["logo", "identity", "brand mark", "sting"],
  ["event", "keynote", "conference", "opener", "stage"],
  ["data", "infographic", "chart", "report"],
  ["title", "opening", "credits", "typography"],
];

export type Film = {
  id: string;
  format: number; // row, 0-based
  industry: number; // column, 0-based
  brand: string;
  title: string;
  seconds: number;
  duration: string;
  ratios: string[];
  tags: string[];
  poster: string;
  turnaround: string;
  keywords: string[];
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export const FILMS: Film[] = FORMATS.flatMap((_, f) =>
  INDUSTRIES.map((_, i) => {
    const seconds = BASE_SECONDS[f] + NUDGE[i] * (f === 3 || f === 6 ? 0 : 1);
    return {
      id: `${FORMAT_SLUGS[f]}-${INDUSTRY_SLUGS[i]}`,
      format: f,
      industry: i,
      brand: BRANDS[i],
      title: `${BRANDS[i]} ${FORMAT_NOUN[f]}`,
      seconds,
      duration: clock(seconds),
      ratios: RATIOS[f],
      tags: TAGS[f],
      poster: `/studio/media/films/${FORMAT_SLUGS[f]}-${INDUSTRY_SLUGS[i]}.jpg`,
      turnaround: TURNAROUND[f],
      keywords: [BRANDS[i], FORMATS[f], INDUSTRIES[i], ...INDUSTRY_WORDS[i], ...FORMAT_WORDS[f], ...TAGS[f]],
    };
  }),
);

/** 1-based position in the 50-film matrix: (format × 5) + industry + 1 */
export const filmNumber = (format: number, industry: number) =>
  format * INDUSTRIES.length + industry + 1;

export const filmAt = (format: number, industry: number) => FILMS[filmNumber(format, industry) - 1];

export const pad2 = (n: number) => String(n).padStart(2, "0");

// ---------- Film detail: hero frame, chapters, case study ----------

/** Wide frame for the panel and theater; only AURELLE has a dedicated 16:9 hero so far. */
export const heroFor = (film: Film) =>
  film.id === "product-launch-beauty" ? "/studio/media/case/aurelle-hero.jpg" : film.poster;

export const CHAPTERS = [
  { label: "Hook", at: 0.08 },
  { label: "Reveal", at: 0.34 },
  { label: "Product", at: 0.58 },
  { label: "End card", at: 0.86 },
] as const;

const IDEAS = [
  "Light becomes the product.",
  "A feeling before a feature.",
  "Complexity, folded into one idea.",
  "Stop the thumb in the first frame.",
  "Every surface, perfectly lit.",
  "The interface as choreography.",
  "A mark that moves like the brand.",
  "Make the room hold its breath.",
  "Numbers with a pulse.",
  "The first ten seconds set the tone.",
];

const CRAFT = [
  "Macro CGI, liquid simulation, gold caustics.",
  "Live action, anamorphic lenses, warm grade.",
  "2D motion system, voiceover, sound design.",
  "Kinetic type, punchy edit, sound-first.",
  "Studio CGI, macro detail, physically based light.",
  "UI animation, device renders, haptic sound.",
  "Logo animation, motion principles, sonic logo.",
  "Stage visuals, LED mapping, live playback.",
  "Data viz, animated charts, narrative pacing.",
  "Typography, compositing, title design.",
];

export type CaseStudy = {
  brief: string;
  idea: string;
  craft: string;
  frames: { label: string; src: string; treatment?: "sketch" | "clay" }[];
};

export function caseFor(film: Film): CaseStudy {
  const aurelle = film.id === "product-launch-beauty";
  return {
    brief: aurelle
      ? "Launch a new eau de parfum in 45 seconds."
      : `${FORMATS[film.format]} for ${film.brand}, in ${film.duration}.`,
    idea: aurelle ? "Light becomes the scent." : IDEAS[film.format],
    craft: CRAFT[film.format],
    // Only AURELLE has real storyboard/animatic frames; the rest show the poster through a treatment
    frames: [
      { label: "Storyboard", src: aurelle ? "/studio/media/case/aurelle-storyboard.jpg" : film.poster, treatment: aurelle ? undefined : "sketch" },
      { label: "Styleframe", src: film.poster },
      { label: "Animatic", src: aurelle ? "/studio/media/case/aurelle-animatic.jpg" : film.poster, treatment: aurelle ? undefined : "clay" },
      { label: "Final", src: heroFor(film) },
    ],
  };
}

/** Caption lines, one per chapter (shown when captions are on). */
export function captionsFor(film: Film) {
  return [
    `${film.brand}.`,
    IDEAS[film.format],
    film.tags.join(" · "),
    `${film.brand} — ${FORMATS[film.format].toLowerCase()}.`,
  ];
}
