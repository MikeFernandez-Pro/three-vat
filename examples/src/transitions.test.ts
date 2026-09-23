import { describe, expect, it } from "vitest";
import type { VATInstance } from "three-vat";
import {
  COLUMNS,
  MAX_COUNT,
  MAX_DWELL,
  MIN_DWELL,
  cellOf,
  clipOfSwitch,
  desyncOf,
  drawsLine,
  dwellOf,
  inFlight,
  switchTimeOf,
  switchesBy,
  transitionsLine,
} from "./transitions.js";

// The crossfade pages' own logic: where the crowd stands, which instance
// switches clip when, how many are mid-transition right now, and the two HUD
// lines the pair has to agree on word for word.
//
// The schedule is the half a visitor cannot check by looking: "several in
// flight at once" is a claim about a spread of timers, and a crowd that
// happened to switch in lockstep would still look like a crowd switching. So
// the timers are asserted here rather than eyeballed — and the in-flight count
// is read back through the library's own resolver, which is the same question
// the shader answers about the same pack.

const PITCH = 2;

/** A band of a bake, as the pack carries one: thirty frames at thirty fps. */
const BAND = { startFrame: 0, frames: 30, fps: 30 };

/** An instance that switched clip at `at`, blending over `duration`. */
const switched = (at: number, duration: number): VATInstance => ({
  clip: BAND,
  startTime: at,
  fadeDuration: duration,
  from: { clip: BAND, startTime: at - 1 },
});

describe("where the crowd stands", () => {
  it("lays the whole crowd out in a grid centred on the origin", () => {
    const cells = Array.from({ length: MAX_COUNT }, (_, i) => cellOf(i, PITCH));

    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean(cells.map((c) => c.x))).toBeCloseTo(0);
    expect(mean(cells.map((c) => c.z))).toBeCloseTo(0);
  });

  it("gives every instance its own cell, and fills the grid front row first", () => {
    const seen = new Set(Array.from({ length: MAX_COUNT }, (_, i) => `${cellOf(i, PITCH).x},${cellOf(i, PITCH).z}`));

    expect(seen.size).toBe(MAX_COUNT);
    // Row-major, so the count slider grows the crowd a row at a time...
    expect(cellOf(1, PITCH).x - cellOf(0, PITCH).x).toBeCloseTo(PITCH);
    // ...and away from the camera, so the first instances of the layout are the
    // front row rather than the one on the horizon.
    expect(cellOf(COLUMNS, PITCH).z - cellOf(0, PITCH).z).toBeCloseTo(-PITCH);
  });

  it("starts every instance a different way into its clip", () => {
    const starts = Array.from({ length: MAX_COUNT }, (_, i) => desyncOf(i, 2));

    for (const start of starts) {
      // In the past, which is the whole of what desync is.
      expect(start).toBeLessThanOrEqual(0);
      expect(start).toBeGreaterThan(-2);
    }
    expect(new Set(starts.map((s) => s.toFixed(3))).size).toBeGreaterThan(MAX_COUNT / 2);
  });
});

describe("when an instance switches clip", () => {
  it("gives each one a dwell of its own, inside a band that reads as a crowd", () => {
    const dwells = Array.from({ length: MAX_COUNT }, (_, i) => dwellOf(i));

    for (const dwell of dwells) {
      expect(dwell).toBeGreaterThanOrEqual(MIN_DWELL);
      expect(dwell).toBeLessThanOrEqual(MAX_DWELL);
    }
    expect(new Set(dwells.map((d) => d.toFixed(3))).size).toBeGreaterThan(MAX_COUNT / 4);
    // Keyed by the index, so a reload runs the same crowd on the same timers.
    expect(dwellOf(7)).toBe(dwellOf(7));
  });

  it("counts a switch from the moment the schedule says it happens", () => {
    for (const index of [0, 5, MAX_COUNT - 1]) {
      const first = switchTimeOf(index, 1);

      expect(switchesBy(index, first - 1e-6)).toBe(0);
      expect(switchesBy(index, first)).toBe(1);
      expect(switchesBy(index, switchTimeOf(index, 2))).toBe(2);
      // And the gap between two of them is that instance's own dwell.
      expect(switchTimeOf(index, 2) - first).toBeCloseTo(dwellOf(index));
    }
  });

  it("never lets an instance start before the page does", () => {
    for (let index = 0; index < MAX_COUNT; index++) {
      expect(switchTimeOf(index, 1)).toBeGreaterThan(0);
      expect(switchesBy(index, 0)).toBe(0);
    }
  });

  it("spreads the crowd's first switches rather than switching it in one go", () => {
    // The page's whole claim is that several transitions are running at once,
    // each begun at its own moment. A crowd whose timers all fired together
    // would show one transition N times and read as a cut of the whole field.
    const firsts = Array.from({ length: MAX_COUNT }, (_, i) => switchTimeOf(i, 1));

    expect(new Set(firsts.map((t) => t.toFixed(3))).size).toBeGreaterThan(MAX_COUNT / 2);
    expect(Math.max(...firsts) - Math.min(...firsts)).toBeGreaterThan(MIN_DWELL / 2);
  });
});

describe("what an instance switches to", () => {
  it("never plays the clip it was already playing", () => {
    for (const clipCount of [2, 3, 4]) {
      for (const index of [0, 1, 17]) {
        for (let n = 1; n < 12; n++) {
          expect(clipOfSwitch(index, n, clipCount)).not.toBe(clipOfSwitch(index, n - 1, clipCount));
        }
      }
    }
  });

  it("names a clip the bake actually has", () => {
    for (let n = 0; n < 20; n++) {
      const clip = clipOfSwitch(3, n, 3);
      expect(Number.isInteger(clip)).toBe(true);
      expect(clip).toBeGreaterThanOrEqual(0);
      expect(clip).toBeLessThan(3);
    }
  });

  it("does not start the whole crowd on one clip", () => {
    const opening = new Set(Array.from({ length: MAX_COUNT }, (_, i) => clipOfSwitch(i, 0, 3)));

    expect(opening.size).toBe(3);
  });
});

describe("how many instances are mid-transition", () => {
  // Read back through the library's own resolver — the same question the
  // shader answers about the same pack — so the HUD's number is measured off
  // the crowd rather than predicted from the schedule that wrote it.
  it("counts an instance while its outgoing band is still showing, and not after", () => {
    const instances = [switched(10, 0.5)];

    expect(inFlight(instances, 1, 10)).toBe(1);
    expect(inFlight(instances, 1, 10.25)).toBe(1);
    expect(inFlight(instances, 1, 10.5)).toBe(0);
    expect(inFlight(instances, 1, 40)).toBe(0);
  });

  it("counts no transition for a cut, however recently it was written", () => {
    // Zero is a cut: the pack carries no outgoing band at all, so there is
    // nothing in flight even at the moment of the write.
    expect(inFlight([switched(10, 0)], 1, 10)).toBe(0);
  });

  it("counts an instance that has never switched as standing still", () => {
    expect(inFlight([{ clip: BAND, startTime: 0 }], 1, 5)).toBe(0);
  });

  it("measures only the instances that are drawn", () => {
    // The count slider draws a prefix of the layout, so a figure taken over the
    // whole of it would be counting robots nobody can see.
    const instances = [switched(10, 0.5), switched(10, 0.5), switched(10, 0.5)];

    expect(inFlight(instances, 3, 10.1)).toBe(3);
    expect(inFlight(instances, 1, 10.1)).toBe(1);
    expect(inFlight(instances, 0, 10.1)).toBe(0);
  });
});

describe("what the HUD reports", () => {
  it("says a cut is a cut, and a blend how long it lasts", () => {
    expect(transitionsLine(48, 0)).toMatch(/cut/);
    expect(transitionsLine(48, 0.45)).toContain("0.45");
    expect(transitionsLine(48, 0.45)).not.toMatch(/cut/);
  });

  it("counts the crowd the number is measured over", () => {
    expect(transitionsLine(2, 0.45)).toMatch(/2 robots/);
    expect(transitionsLine(1, 0.45)).toMatch(/1 robot\b/);
  });

  it("says both clips are still playing, which is the whole claim", () => {
    // The pair reports one crowd in one form of words: the lines are shared so
    // the two pages cannot drift (ADR-0011 duplicates the wiring, not the
    // prose).
    expect(transitionsLine(48, 0.45)).toContain("both clips still playing");
  });

  it("reports the draw calls the renderer measured, not a number typed in", () => {
    expect(drawsLine(7)).toMatch(/\b7\b/);
    expect(drawsLine(7)).toMatch(/draw calls/);
  });
});
