import { describe, expect, it } from "vitest";
import { createStallMeter } from "./stall.js";

describe("the stall meter", () => {
  it("measures a bake on this thread as the gap it left, frame before to frame after", async () => {
    const meter = createStallMeter();
    meter.frame(0);
    meter.frame(16);
    meter.start();
    // The bake blocks here: no frame lands until it returns.
    const longest = meter.stop();
    meter.frame(516);
    expect(await longest).toBe(500);
  });

  it("measures a bake elsewhere as the longest of the frames drawn meanwhile", async () => {
    const meter = createStallMeter();
    meter.frame(0);
    meter.start();
    for (const t of [16, 33, 60, 76]) meter.frame(t);
    const longest = meter.stop();
    meter.frame(92);
    expect(await longest).toBe(27);
  });

  it("forgets the last bake's gaps when the next one starts", async () => {
    const meter = createStallMeter();
    meter.frame(0);
    meter.start();
    const first = meter.stop();
    meter.frame(400);
    expect(await first).toBe(400);

    meter.frame(416);
    meter.start();
    const second = meter.stop();
    meter.frame(432);
    expect(await second).toBe(16);
  });

  it("counts nothing while it is not watching", async () => {
    const meter = createStallMeter();
    meter.frame(0);
    meter.frame(900);
    meter.start();
    const longest = meter.stop();
    meter.frame(916);
    expect(await longest).toBe(16);
  });
});
