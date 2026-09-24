// The worker example's evidence: the longest gap between two frames while a
// bake ran. A bake on the main thread is one long task, and the page draws
// nothing until it returns — that gap is the freeze a visitor sees. The same
// bake in a worker leaves the frame loop alone, and the gap stays a frame.
//
// Renderer-agnostic, and pure: it is handed the loop's timestamps rather than
// reading a clock, so the arithmetic is held in Node.

export interface StallMeter {
  /** Call once per frame, with that frame's timestamp in milliseconds. */
  frame(now: number): void;
  /** Start counting gaps, from the last frame drawn. */
  start(): void;
  /**
   * Stop once the next frame lands, and resolve with the longest gap seen, in
   * milliseconds. The next frame, not now: a bake on this thread returns
   * *before* the frame it held back, and that frame's gap is the whole freeze.
   */
  stop(): Promise<number>;
}

export function createStallMeter(): StallMeter {
  let last: number | null = null;
  let watching = false;
  let longest = 0;
  let finish: ((ms: number) => void) | null = null;

  return {
    frame(now) {
      if (watching && last !== null) longest = Math.max(longest, now - last);
      last = now;
      if (finish) {
        const resolve = finish;
        finish = null;
        watching = false;
        resolve(longest);
      }
    },
    start() {
      watching = true;
      longest = 0;
    },
    stop() {
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
}
