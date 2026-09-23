import { describe, expect, it } from "vitest";
import {
  COLUMNS,
  HOME_TEXELS,
  MAX_COUNT,
  cellOf,
  crowdLine,
  gainOf,
  homeRows,
  twistAngleOf,
  twistLine,
  twistProfile,
  widestTwist,
} from "./deforming.js";

// The deform pages' own arithmetic: where an instance stands, what it twists
// by, and the two HUD lines the pair has to agree on word for word. Everything
// the shader does is in here in JavaScript too — not as a second
// implementation, but because the HUD reports the twist it is under and a
// figure nobody can check is a figure ADR-0020 does not allow on a page.

const PITCH = 2;

describe("where the crowd stands", () => {
  it("lays the whole crowd out in a grid centred on the origin", () => {
    const cells = Array.from({ length: MAX_COUNT }, (_, i) => cellOf(i, PITCH));

    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean(cells.map((c) => c.x))).toBeCloseTo(0);
    expect(mean(cells.map((c) => c.z))).toBeCloseTo(0);
  });

  it("gives every instance its own cell, a pitch apart", () => {
    const seen = new Set(Array.from({ length: MAX_COUNT }, (_, i) => `${cellOf(i, PITCH).x},${cellOf(i, PITCH).z}`));

    expect(seen.size).toBe(MAX_COUNT);
    // Row-major, so neighbours in the count are neighbours on the ground: the
    // count slider grows the crowd a row at a time rather than scattering it.
    expect(cellOf(1, PITCH).x - cellOf(0, PITCH).x).toBeCloseTo(PITCH);
    // …and away from the camera, so the first robots of the layout are the
    // front row rather than the one on the horizon.
    expect(cellOf(COLUMNS, PITCH).z - cellOf(0, PITCH).z).toBeCloseTo(-PITCH);
  });
});

describe("the angle one instance twists by", () => {
  // The rule the GLSL and the node graph both implement: the yaw from where
  // this instance stands to the target, clamped so the crowd leans rather than
  // spins, scaled by its own gain.
  const limit = Math.PI / 4;

  it("turns an instance toward a target directly ahead of it, which is no turn at all", () => {
    expect(twistAngleOf({ x: 0, z: 0, gain: 1 }, { x: 0, z: 10 }, limit)).toBeCloseTo(0);
  });

  it("turns toward the side the target is on", () => {
    // +x is a positive yaw, because the crowd is authored facing +z and a
    // positive rotation about y takes +z toward +x.
    expect(twistAngleOf({ x: 0, z: 0, gain: 1 }, { x: 10, z: 10 }, limit)).toBeGreaterThan(0);
    expect(twistAngleOf({ x: 0, z: 0, gain: 1 }, { x: -10, z: 10 }, limit)).toBeLessThan(0);
  });

  it("clamps, so a target behind the crowd is a twist and never a spin", () => {
    expect(twistAngleOf({ x: 0, z: 0, gain: 1 }, { x: 1, z: -10 }, limit)).toBeCloseTo(limit);
    expect(twistAngleOf({ x: 0, z: 0, gain: 1 }, { x: -1, z: -10 }, limit)).toBeCloseTo(-limit);
  });

  it("scales by the instance's own gain, so no two turn alike", () => {
    const full = twistAngleOf({ x: 0, z: 0, gain: 1 }, { x: 10, z: 0 }, limit);

    expect(twistAngleOf({ x: 0, z: 0, gain: 0.5 }, { x: 10, z: 0 }, limit)).toBeCloseTo(full / 2);
  });

  it("reads where the instance stands, not where the crowd's centre is", () => {
    // The whole reason the page carries per-instance data at all: two instances
    // either side of the target lean toward each other, not in parallel.
    const left = twistAngleOf({ x: -6, z: 0, gain: 1 }, { x: 0, z: 6 }, limit);
    const right = twistAngleOf({ x: 6, z: 0, gain: 1 }, { x: 0, z: 6 }, limit);

    expect(left).toBeGreaterThan(0);
    expect(right).toBeLessThan(0);
  });
});

describe("the per-instance data the shader reads by index", () => {
  it("gives each instance a gain of its own, in a band that reads as variety", () => {
    const gains = Array.from({ length: MAX_COUNT }, (_, i) => gainOf(i));

    for (const gain of gains) {
      expect(gain).toBeGreaterThanOrEqual(0.55);
      expect(gain).toBeLessThanOrEqual(1);
    }
    expect(new Set(gains.map((g) => g.toFixed(3))).size).toBeGreaterThan(MAX_COUNT / 4);
    // Keyed by the index, so a reload twists the same crowd the same way.
    expect(gainOf(7)).toBe(gainOf(7));
  });

  it("packs one texel per instance: where it stands, and how far it turns", () => {
    const rows = homeRows(PITCH);

    expect(rows).toHaveLength(MAX_COUNT * HOME_TEXELS);
    for (const index of [0, 1, MAX_COUNT - 1]) {
      const { x, z } = cellOf(index, PITCH);
      // Close rather than equal: the rows are the texture's own bytes, and a
      // `Float32Array` is where a gain goes to lose its last few digits.
      const [px, pz, gain] = rows.slice(index * HOME_TEXELS, index * HOME_TEXELS + 3);
      expect(px).toBeCloseTo(x);
      expect(pz).toBeCloseTo(z);
      expect(gain).toBeCloseTo(gainOf(index));
    }
  });
});

describe("the height the twist eases in over", () => {
  it("leaves the feet planted and has the whole turn by the shoulders", () => {
    // In the bake's own units, off the baked bounds, because the chunk runs
    // before the instance matrix has scaled anything.
    const { knee, span } = twistProfile(0, 5);

    expect(knee).toBeGreaterThan(0);
    expect(knee + span).toBeLessThanOrEqual(5);
    expect(span).toBeGreaterThan(0);
  });

  it("follows the model it was measured on rather than a typed-in height", () => {
    const small = twistProfile(0, 2);
    const large = twistProfile(0, 20);

    expect(large.knee).toBeCloseTo(small.knee * 10);
    expect(large.span).toBeCloseTo(small.span * 10);
  });

  it("starts from the model's own floor, wherever the bake put it", () => {
    expect(twistProfile(-3, 5).knee).toBeCloseTo(twistProfile(0, 5).knee - 3);
  });
});

describe("what the HUD reports", () => {
  it("reports the widest twist on screen, in degrees, measured from the crowd it has", () => {
    // Not the limit: the limit is what the crowd may do, and this is what it is
    // doing. A target in front of a crowd standing behind it twists nobody.
    const straightAhead = widestTwist(40, PITCH, { x: 0, z: 400 }, Math.PI / 4);
    const alongside = widestTwist(40, PITCH, { x: 0, z: 0 }, Math.PI / 4);

    expect(straightAhead).toBeLessThan(alongside);
    expect(alongside).toBeGreaterThan(0);
  });

  it("measures only the instances that are drawn", () => {
    // The count slider draws a prefix of the layout, so a figure taken over the
    // whole of it would be reporting robots nobody can see.
    const target = { x: 0, z: 0 };
    expect(widestTwist(1, PITCH, target, Math.PI / 4)).not.toBe(widestTwist(MAX_COUNT, PITCH, target, Math.PI / 4));
  });

  it("says what the number is and what it is evidence of, once", () => {
    expect(twistLine(0.5)).toMatch(/limit/);
    expect(crowdLine(2)).toMatch(/2 robots/);
    expect(crowdLine(1)).toMatch(/1 robot\b/);
    // The pair reports one crowd in one form of words: the lines are shared so
    // the two pages cannot drift (ADR-0011's duplication is of the wiring, not
    // of the prose).
    expect(crowdLine(2)).toContain("its own angle");
  });
});
