import { describe, expect, it } from "vitest";
import { levelFor, verticesDrawn } from "./levels.js";

describe("levelFor", () => {
  const bands = [12, 28];

  it("draws the full detail nearest, and each band further a level simpler", () => {
    expect([0, 11.9, 12, 27.9, 28, 500].map((d) => levelFor(d, bands))).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it("draws the full detail everywhere with no bands", () => {
    expect(levelFor(1000, [])).toBe(0);
  });

  it("keeps an instance on its level until it is a slack past the band, either way", () => {
    // 12 m with a tenth of slack: out to 13.2 m before the half, back in to 10.8 m before the full.
    expect(levelFor(13, bands, 0, 0.1)).toBe(0);
    expect(levelFor(13.25, bands, 0, 0.1)).toBe(1);
    expect(levelFor(11, bands, 1, 0.1)).toBe(1);
    expect(levelFor(10.7, bands, 1, 0.1)).toBe(0);
  });

  it("crosses every band it is past in one call, a camera cut included", () => {
    expect(levelFor(500, bands, 0, 0.1)).toBe(2);
    expect(levelFor(1, bands, 2, 0.1)).toBe(0);
  });

  it("never stops on a level its distance is a slack outside of", () => {
    // Swinging back and forth across 12 m by less than the slack changes nothing.
    let level = 1;
    for (const d of [11.5, 12.5, 11.2, 12.9, 11.0]) level = levelFor(d, bands, level, 0.1);
    expect(level).toBe(1);
  });
});

describe("verticesDrawn", () => {
  it("counts the vertices an index names, once each, not the ones a level keeps and never draws", () => {
    expect(verticesDrawn([3, 1, 2, 2, 1, 3])).toBe(3);
    expect(verticesDrawn(Uint32Array.from([0, 1, 2, 0, 2, 5]))).toBe(4);
  });
});
