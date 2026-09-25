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
/**
 * One clip playing, as this table spells it — the library's `VATPlaybackState`
 * with the clip named by index instead of by band, because a table written
 * against a bake it has not seen cannot hold a band.
 *
 * Its own type rather than three fields written twice, and split from
 * {@link ParityInstance} exactly where the library splits its own (ADR-0025): an
 * instance is a playback state plus where it stands and what it is leaving, and
 * the band it is leaving is a playback state and nothing more.
 */
export interface ParityPlayback {
  /** Index into `vat.clips`. */
  clipIndex: number;
  /** Clock time this animation began — in the past, so it is mid-clip. */
  startTime: number;
  speed: number;
}

export interface ParityInstance extends ParityPlayback {
  /** World x. Everything stands on y = 0, facing the camera. */
  x: number;
  /**
   * The band this instance is blending out of — a clip *still playing*, resolved
   * by the very same arithmetic as the live one (ADR-0025). Absent on an
   * instance that is not transitioning, which is every one but {@link CROSSFADE}'s.
   */
  from?: ParityPlayback;
  /** Seconds to blend {@link ParityInstance.from} away over, from `startTime`. */
  fadeDuration?: number;
}

/**
 * The transition the gate renders, and why its two numbers are what they are.
 *
 * A crossfade is two bands sampled and mixed, which is a *third* decode on each
 * path — and one whose bug has a shape none of the others do: get the weight
 * wrong and both bands are still the right bands, still on the right rows, just
 * mixed in the wrong proportion. So the gate's crowd has to be caught
 * mid-transition, and "mid" has to be somewhere the weight cannot accidentally
 * be right.
 *
 * At either end of the interval it could be. A weight of 1 is the live band
 * alone; a weight of 0 is the outgoing band gone — both are what a path that
 * dropped the crossfade entirely would render, so a frame captured there proves
 * nothing. The duration below puts the weight at very nearly a half at `TIME`
 * (`instance` starts at -0.37, so 1.604 s have elapsed of 3.2), where every
 * plausible mistake — a dropped blend, a weight read off the wrong clock, the
 * doubled duration {@link FAULT_FADE_SCALE} injects — lands somewhere else.
 *
 * Asserted rather than eyeballed: scene.test.ts resolves this instance
 * through `resolveVATFrame` and requires the outgoing weight to sit well inside
 * the open interval, so a later edit to `TIME` or to the table cannot quietly
 * slide the gate onto an endpoint.
 *
 * The middle instance carries it — dead centre, and the largest in frame — and
 * it is the only one that does: a second transition would add pixels without
 * adding a question, and the table below is where to read which. Spread into it
 * rather than named by index here, so there is no index to drift.
 *
 * The outgoing band is a *different* clip from the live one, so the mix has two
 * genuinely different poses to get wrong, and carries its own `startTime` so it
 * is mid-clip too — an outgoing band frozen on its first row would blend away a
 * rest pose, which is the thing the crossfade replaced (ADR-0025).
 */
export const CROSSFADE = {
  from: { clipIndex: 2, startTime: -1.9, speed: 1 },
  fadeDuration: 3.2,
} as const;

/**
 * The third deliberate fault, beside {@link FAULT_FRAMES} and
 * `withWrongNormals`: the transitioning instance's fade made to last this many
 * times as long.
 *
 * It moves the *blend* and nothing else. Both bands stay the bands they were,
 * on the rows they were, at the phases they were — only the proportion they are
 * mixed in changes, from very nearly a half to very nearly three quarters. That
 * is the shape of a crossfade bug a path can have alone: the weight is computed
 * beside the band resolver on each path (`vatRows` in src/webgl.ts, `vatDecode`
 * in src/tsl.ts) rather than inside the function they share, so it is the half
 * of the transition the two paths do *not* hold in common.
 *
 * Doubled rather than zeroed: a duration of zero is a cut, which removes the
 * outgoing band altogether and would be caught by anything that noticed the
 * band was gone. This keeps both bands and moves only the number between them.
 */
export const FAULT_FADE_SCALE = 2;

export const INSTANCES: readonly ParityInstance[] = [
  { clipIndex: 0, startTime: 0, speed: 1, x: -1.15 },
  { clipIndex: 1, startTime: -0.37, speed: 1, x: 0, from: CROSSFADE.from, fadeDuration: CROSSFADE.fadeDuration },
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
 * The gate's second case: a rig-encoded bake (ADR-0018).
 *
 * A second encoding is a second decode on each path — four slots skinned from
 * a rig texture, where the vertex encoding reads a texel per vertex — so the
 * robot's two paths agreeing proves nothing about this one's. It renders in
 * the same room, at the same clock, through the same `createVATMesh`, and its
 * frames are compared through the same tolerance; only the asset and the bake
 * option differ.
 *
 * Soldier, because the rig encoding was measured on it (ADR-0018's table) and
 * the real-asset suite pins its rig bake against the mixer, so what the gate
 * renders here is a bake already proven right on the CPU. It is the asset
 * `node scripts/fetch-test-assets.mjs` fetches (docs/test-assets.md), served
 * beside the demo's `public/` by release/vite.config.ts; the path is relative
 * to the gate's page for the same reason the robot's is (run.ts).
 */
export const RIG_CASE = {
  model: "../test-assets/Soldier.glb",
  /**
   * Resolved by name in this order, so `INSTANCES[i].clipIndex` means the same
   * clip on every run whatever order the file lists them in. `TPose` is left
   * out on purpose: it bakes as a frozen pose (the asset's rest pose *is* its
   * T-pose), and a frozen instance would not move under the slip.
   */
  clips: ["Idle", "Walk", "Run"],
  encoding: "rig",
  /**
   * Soldier faces −z and the camera stands at +z, so the crowd is turned to
   * face it. A back would compare as well as a face — the gate reads pixels,
   * not expressions — but a human looking at a failure should see the same
   * thing the demo shows.
   */
  yaw: Math.PI,
} as const;

/**
 * The gate's third bake: the robot again under the vertex encoding, at a
 * ceiling too narrow for its 7 214 vertices, so every frame spans two rows of
 * 3 607 (ADR-0030).
 *
 * 4096 because it is a real one — the Xiaomi Mi 9's, which refused both
 * shipped assets under the vertex encoding before a frame could span rows
 * (#77) — and because two rows is the smallest span, where half the vertices
 * are read from the second row of their frame. The texels are the one-row
 * bake's, stored elsewhere, so the frame each path draws from it must be the
 * frame it drew from that bake: a wrong column or row moves the vertex.
 */
export const SPAN_CASE = { maxTextureSize: 4096, rowsPerFrame: 2 } as const;

/**
 * One instance of the reference crowd: a clip caught on one of its baked rows.
 */
export interface ReferenceInstance {
  /** Index into `vat.clips`, and into the clips the bake was handed. */
  clipIndex: number;
  /** The baked row of that clip the instance stands on at {@link REFERENCE}'s time. */
  frame: number;
  /** World x. Everything stands on y = 0. */
  x: number;
  /** Turn about y, on top of the case's own (`RIG_CASE.yaw`). */
  yaw: number;
}

/**
 * The gate's third image: three's own `SkinnedMesh`, driven by an
 * `AnimationMixer`, beside the VAT crowd of the same bake (#90).
 *
 * Every comparison above this one is between the two decode paths, so a bug
 * the two share passes all of them: a normal matrix, the order the instance
 * matrix is applied in, a turn put on the wrong side of a part's offset. This
 * one compares each path with the renderer's own skinning, which is the
 * picture the bake set out to reproduce.
 *
 * Its own crowd, not {@link INSTANCES}, for two reasons, each a thing the
 * mixer cannot be asked to agree with:
 *
 * - **No crossfade.** The mixer blends bone transforms where the VAT blends
 *   rows, so a mid-fade frame from each is a different pose by design.
 * - **Every instance on a baked row.** Between rows the VAT interpolates
 *   positions linearly where the mixer interpolates the bones, and the two
 *   differ by exactly what the bake's fps chose to throw away. On a row they
 *   are the same pose to the texture's precision. `frame` is below every
 *   clip's frame count on both assets (the shortest, Soldier's `Run`, has 21).
 *
 * Each instance is turned by its own `yaw`, none of them a multiple of a
 * quarter turn, so an instance matrix applied in the wrong order moves a
 * part's offset and shows. Each path is compared with its *own* renderer's
 * reference, so a backend difference is not read as a decode one.
 */
export const REFERENCE = {
  time: TIME,
  instances: [
    { clipIndex: 0, frame: 9, x: -1.15, yaw: 0.6 },
    { clipIndex: 1, frame: 14, x: 0, yaw: -0.45 },
    { clipIndex: 2, frame: 17, x: 1.15, yaw: -1.1 },
  ] as readonly ReferenceInstance[],
} as const;

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
