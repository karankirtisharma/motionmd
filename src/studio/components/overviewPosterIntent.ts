export const OVERVIEW_POSTER_SIZES = "(orientation: portrait) 18vw, 9vw";

type FilmPosition = { format: number; industry: number };

/** First cells in the overview's existing outward ripple, including the selection. */
export function firstOverviewPosters<T extends FilmPosition>(films: T[], format: number, industry: number): T[] {
  const distance = (film: T) => (film.format - format) ** 2 + (film.industry - industry) ** 2;
  return [...films].sort((a, b) => distance(a) - distance(b)).slice(0, 9);
}

export function createOverviewIntent(prepare: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  function cancel() {
    clearTimeout(timer);
    timer = undefined;
  }
  function schedule() {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      prepare();
    }, 90);
  }
  return { cancel, schedule };
}
