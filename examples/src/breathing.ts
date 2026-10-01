// The crowd page's breathing count: how many soldiers it draws while nobody
// holds the slider.
//
// The page opens on the full circle, and the count falls to a floor and rises
// back in a slow sine, so the draw-call readout holding at one is seen while
// the crowd changes size, without a visitor touching anything. Grabbing the
// slider stops it; the page's `breathe` switch starts it again from the count
// the slider left, falling, as it opened.
//
// Kept free of three.js and the DOM so breathing.test.ts runs it in Node.

/** The wave: between `floor` and `max` soldiers, once every `period` seconds. */
export interface Breath {
  floor: number;
  max: number;
  period: number;
}

/** The count `elapsed` seconds into the wave: the full circle at 0, the floor half a period in. */
export function breathingCount(elapsed: number, { floor, max, period }: Breath): number {
  const fullness = (1 + Math.cos((2 * Math.PI * elapsed) / period)) / 2;
  return Math.round(floor + (max - floor) * fullness);
}

/** The moment of the wave's falling half at which it draws `count`, for a wave started again from there. */
export function breathFrom(count: number, { floor, max, period }: Breath): number {
  const fullness = Math.min(1, Math.max(0, (count - floor) / (max - floor)));
  return (Math.acos(2 * fullness - 1) / (2 * Math.PI)) * period;
}
