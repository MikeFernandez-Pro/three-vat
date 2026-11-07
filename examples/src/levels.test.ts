import { describe, expect, it } from "vitest";
import { verticesDrawn } from "./levels.js";

describe("verticesDrawn", () => {
  it("counts the vertices an index names, once each, not the ones a level keeps and never draws", () => {
    expect(verticesDrawn([3, 1, 2, 2, 1, 3])).toBe(3);
    expect(verticesDrawn(Uint32Array.from([0, 1, 2, 0, 2, 5]))).toBe(4);
  });
});
