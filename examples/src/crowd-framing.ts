// How far the crowd page's camera stands to frame the soldiers on show. The
// crowd is a sunflower spiral, so the first N soldiers are a round crowd whose
// radius grows as the square root of N; the camera backs off in step with it,
// from a close-up of the one soldier to the page's framing of the whole crowd.
//
// No three.js: a count in, a distance out.

/**
 * The distance that frames the first `count` soldiers of a crowd of `max`:
 * `close` for one, `full` for all of them, and in between in step with the
 * radius of the soldiers drawn.
 */
export function framingDistance(count: number, max: number, close: number, full: number): number {
  // Soldier i stands at sqrt(i + 0.5) spacings from the middle; the outermost
  // of the first n is soldier n - 1. The spacing scales both ends alike, so it
  // drops out.
  const radius = (n: number) => Math.sqrt(Math.min(Math.max(n, 1), max) - 0.5);
  if (max <= 1) return full;
  return close + ((full - close) * (radius(count) - radius(1))) / (radius(max) - radius(1));
}
