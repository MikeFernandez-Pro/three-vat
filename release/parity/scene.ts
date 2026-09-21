// The scene the release gate renders, spelled once as data.
//
// Shared by both paths on purpose, and it is the one thing in this harness that
// is: a difference in camera, light or time between the two renders would be
// indistinguishable from a difference in decode, which is the only thing the
// gate exists to see. Everything *renderer-shaped* stays duplicated in
// webgl-frame.ts and tsl-frame.ts (ADR-0011); this file holds only the numbers,
// and imports neither three.js nor three-vat so it stays that way.
//
// Every choice below is in service of one goal: nothing in the frame may differ
// between the two backends except the decode. So — no antialiasing (the two
// resolve multisamples differently), no shadows, no environment map, no fog, no
// tone mapping, pixel ratio pinned to 1. What is left is flat-lit geometry, and
// where that geometry *is* comes from the VAT.

/** Square, so a transposed readback cannot pass as a correctly sized one. */
export const FRAME = { width: 384, height: 384 } as const;

/** Solid backdrop. Dark, so the robots' silhouettes carry most of the signal. */
export const BACKGROUND = 0x1a1d23;

/** Elapsed VAT time of the compared frame. Off any clip boundary, deliberately. */
export const TIME = 1.234;

/**
 * The geometric half of the deliberate bug, in baked frames.
 *
 * The self-test renders one path at `TIME` and the other at `TIME + one frame`,
 * and requires the gate to *fail*. One frame is the smallest slip a decode can
 * make — an off-by-one in the row index, an fps read from the wrong place — so a
 * gate that catches it catches anything coarser. It is injected as a clock
 * offset rather than by editing a shader: the same wrong texels get sampled
 * either way, and this way the proof runs on every gate run instead of living in
 * a branch someone has to remember to make.
 *
 * On its own it would prove too little, because it moves the silhouette and
 * almost any tolerance sees that. Its other half is `withWrongNormals` in
 * stage.ts — a fault that moves no geometry at all.
 */
export const FAULT_FRAMES = 1;

/** Bake fps — also what one `FAULT_FRAMES` step is worth in seconds. */
export const FPS = 30;

/** Robot height in world units, so the framing holds whatever the model ships as. */
export const TARGET_HEIGHT = 1.8;

export const CAMERA = {
  fov: 40,
  near: 0.1,
  far: 50,
  position: [0.9, 1.9, 4.6],
  target: [0, 0.95, 0],
} as const;

export const LIGHTS = {
  ambient: { color: 0xffffff, intensity: 0.35 },
  /** Off-axis, so a normal that decoded wrong changes the shading rather than hiding behind it. */
  sun: { color: 0xffffff, intensity: 2.4, position: [3, 5, 2] },
} as const;

/**
 * Three instances, one per baked clip, each at its own phase and rate — so the
 * instance-playback pack is part of what is being compared, not just the
 * texture sampling. Placed across the frame rather than in a ring: a gate frame
 * should be reproducible by reading this table, not by running a layout.
 */
export interface ParityInstance {
  /** Index into `vat.clips`. */
  clipIndex: number;
  /** Clock time this instance's animation began — in the past, so it is mid-clip. */
  startTime: number;
  speed: number;
  /** World x. Everything stands on y = 0, facing the camera. */
  x: number;
}

export const INSTANCES: readonly ParityInstance[] = [
  { clipIndex: 0, startTime: 0, speed: 1, x: -1.15 },
  { clipIndex: 1, startTime: -0.37, speed: 1, x: 0 },
  { clipIndex: 2, startTime: -0.81, speed: 1.3, x: 1.15 },
];

/**
 * A fourth instance for the batched frames, standing outside the camera's
 * frustum — and the only reason the batched frames test *culling* rather than
 * only sorting.
 *
 * ADR-0016 measured the failure this carrier risks, and it was culling that
 * caused it: with per-instance culling on, the drawn list is a *subset* of the
 * instances and every slot after the hole shifts. Sorting alone permutes the
 * list; culling shortens it, which is the harder case and the one that broke.
 *
 * Close to the camera (`z`, against a camera at z = 4.6) so the default
 * front-to-back depth sort would put it *first*, and far enough to the side
 * that the 40° frustum excludes it. Checked, not hoped: `Frustum` rejects this
 * sphere and accepts all three of {@link INSTANCES}. It is therefore instance 0
 * of the batch and never drawn, so drawn slot 0 resolves to instance 1, slot 1
 * to instance 2, and so on — no drawn slot is its own instance, and a decode
 * reading the slot would put every robot in its neighbour's clip. Being
 * invisible it can change no pixel, which is exactly what the comparison
 * asserts.
 */
export const CULLED_INSTANCE = { clipIndex: 0, startTime: 0, speed: 1, x: 3, z: 3.5 } as const;

/**
 * How the addressing probe paints a vertex.
 *
 * Both paths render the crowd geometry with a material that ignores the VAT
 * entirely and instead paints the two numbers the decode would have looked a
 * texel up with: the vertex's own index — the texture's x — split across two
 * channels so all 7 214 of them fit, and its instance's clip start row, the top of
 * the clip's frame band, which is the texture's y before the clock is applied.
 *
 * Written here, once, so the GLSL and WGSL spellings of it in the two frame
 * modules are demonstrably the same formula.
 *
 *   R = vertexIndex mod 256     — moves for any per-vertex addressing error
 *   G = floor(vertexIndex/256)  — the high byte, so the whole range is covered
 *   B = clip start row          — moves if instance playback is read wrong
 *
 * Every term is exact in 8 bits, so two paths that agree produce byte-identical
 * frames and any disagreement is a real one rather than rounding.
 */
export const PROBE = { channelScale: 255 } as const;

/**
 * How the sampling probe paints a vertex.
 *
 * The addressing probe above covers the texture's x and the top of the clip's
 * frame band. This one covers everything between those and the texel: the whole
 * time-to-row computation, spelled out in each path's own shader language and
 * painted instead of sampled.
 *
 *   R = (f0 + clip start row) mod 256   — the exact texture row the decode reads
 *   G = floor((f0 + clip start row)/256) — its high byte
 *   B = fract(t)                     — the blend factor between the two rows
 *
 * Between the two probes, every input `textureLoad`/`texelFetch` receives is
 * accounted for. If both probes agree and the decoded frames do not, the two
 * paths are being handed the same coordinates and returning different texels,
 * and the fault is in the texture read rather than in the arithmetic above it.
 */
export const SAMPLE_PROBE = { time: TIME } as const;
