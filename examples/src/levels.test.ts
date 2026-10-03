import { describe, expect, it } from "vitest";
import { levelFor } from "./levels.js";

describe("levelFor", () => {
  it("draws the full detail nearest, and each band further a level simpler", () => {
    const bands = [12, 28];

    expect([0, 11.9, 12, 27.9, 28, 500].map((d) => levelFor(d, bands))).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it("draws the full detail everywhere with no bands", () => {
    expect(levelFor(1000, [])).toBe(0);
  });
});
