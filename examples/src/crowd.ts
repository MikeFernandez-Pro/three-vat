// Crowd layout: where each robot stands, and how its ring turns.
//
// Kept free of three.js, the DOM *and* three-vat so the guarantees below can be
// imported and tested directly rather than eyeballed in the browser. All it
// needs of a clip is its name, so it is generic over one.
//
// The demo has one control, the **count** (CONTEXT.md), and this module is
// where it lands: everything — how many rings, how wide, which robot idles and
// which runs — is derived from that single number.

/** The only thing the layout needs to know about a clip. */
export interface ClipRef {
  name: string;
}

/**
 * The bands a rising count reveals, innermost first.
 *
 * `from` is the count at which the band's first robot appears, so the table
 * reads as the demo reads: one robot idling at 1, walkers circling in at 61,
 * runners on the outside at 221. The bands are a property of the count, not a
 * layout the demo is arranged into — raising it is how a reader discovers them
 * (CONTEXT.md, **Count**).
 *
 * Three bands is also the memory dial, because it is three baked clips: a VAT
 * costs `verts x frames x (8 B + 2 B)` — a position delta in four half-floats, a
 * normal in two octahedral bytes — so 7 214 verts at 30 fps is ~11 MB here;
 * adding Wave (55 rows) and Dance (100) would push it past 19 MB.
 */
export const BANDS = [
  { clip: "Idle", label: "idling", speed: 0, from: 1 },
  { clip: "Walking", label: "walking", speed: 1.1, from: 61 },
  { clip: "Running", label: "running", speed: 3.4, from: 221 },
] as const;

export type Band = (typeof BANDS)[number];

/**
 * Which of an asset's clips plays each band, by name. The bands are named for
 * the demo's robot, whose clips happen to be called what the bands are; an
 * example's asset need not agree (Soldier walks in `Walk`), and the asset
 * module says so rather than the layout guessing or the clips being renamed —
 * the texture panel labels a band with the clip's own name.
 */
export type BandClipNames = Readonly<Record<Band["clip"], string>>;

/** The robot's: every band plays the clip of its own name. */
export const ROBOT_CLIP_NAMES: BandClipNames = { Idle: "Idle", Walking: "Walking", Running: "Running" };

/** The top of the count slider — the last robot the table accounts for. */
export const MAX_COUNT = 340;

/**
 * Ring spacing as a multiple of the robot's real width. 1 = shoulder to
 * shoulder; below 1 they would overlap, so the layout is never asked for it.
 */
export const CLEARANCE = 1.25;

/** How many robots a band holds once the count has gone past all of it. */
function bandSize(index: number): number {
  const next = BANDS[index + 1];
  return (next ? next.from : MAX_COUNT + 1) - BANDS[index]!.from;
}

// Per-instance state. `clip`, `startTime` and `speed` go to the GPU once, as a
// row of the playback texture, and are never touched again; `radius`/`angle0`/`omega`
// are read by the CPU each frame to place the instance on the ground.
export interface Robot<C extends ClipRef = ClipRef> {
  clip: C;
  /** When this robot's animation began. In the past — that is what desyncs it. */
  startTime: number; // playback phase (GPU)
  speed: number; // playback rate (GPU)
  /** Ring this instance belongs to, and where on it it started. */
  radius: number;
  angle0: number;
  /** Angular velocity, rad/s. Zero for the in-place idlers. */
  omega: number;
  /** Heading used when `omega` is 0. */
  heading: number;
}

/**
 * A deterministic 0..1 hash, keyed by the robot's place in the crowd. Stands in
 * for `Math.random()` because the layout has to be a *pure function of the
 * count* — see the monotonicity property below — and a real random would give
 * the same robot a different phase every time the count moved.
 *
 * Each varied field draws from its own salted stream, so two fields of one
 * robot never come back the same number.
 */
function hash(index: number, salt: number): number {
  const x = Math.sin((index + salt) * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const PHASE = 0; // salt: how far back this robot started
const RATE = 10_000; // salt: playback rate, idlers only
const HEADING = 20_000; // salt: which way an idler faces

interface Ring {
  radius: number;
  /** How many robots this ring holds in the full crowd. */
  slots: number;
  /** Index within its band: picks the turn direction and rate. */
  index: number;
  band: Band;
}

/**
 * The rings of the *full* crowd, in the order the count fills them.
 *
 * Every ring's radius and occupancy is computed from the band sizes, never from
 * the count — which is what makes the layout a prefix (see below). A band's
 * last ring is usually part-empty; its robots are then spread wider than a
 * footprint, never tighter, so the guarantee is unaffected.
 */
function planRings(footprint: number, gap: number): Ring[] {
  const rings: Ring[] = [];
  let radius = 0;

  for (const [b, band] of BANDS.entries()) {
    let remaining = bandSize(b);
    let index = 0;
    while (remaining > 0) {
      // At radius 0 the capacity formula gives 0; one robot stands dead centre.
      const capacity = Math.max(1, Math.floor((2 * Math.PI * radius) / footprint));
      const slots = Math.min(remaining, capacity);
      rings.push({ radius, slots, index, band });
      remaining -= slots;
      radius += footprint;
      index++;
    }
    radius += footprint * gap; // clear ground between bands
  }
  return rings;
}

/**
 * Lay out the first `count` robots of the crowd, in concentric rings.
 *
 * Two properties make the count slider safe to drag, and both are asserted in
 * `crowd.test.ts` rather than trusted.
 *
 * **No two robots ever overlap**, at any count, for any elapsed time — with no
 * per-frame collision checks:
 *
 * 1. Rings are spaced one `footprint` apart, so no two rings can touch.
 * 2. A ring holds at most `floor(2 pi r / footprint)` robots, evenly spaced, so
 *    neighbours on a ring are at least a footprint of arc apart.
 * 3. Every robot on a ring shares one angular velocity, so the ring turns as a
 *    rigid body — same-ring spacing is constant forever. This is the part that
 *    random per-robot speeds would break: any speed difference eventually
 *    closes any gap.
 *
 * **Raising the count only ever adds.** The result at `count` is a strict
 * prefix of the result at any larger count: same robots, same rings, same
 * clips, with new ones on the end. So the demo lays the full crowd out once and
 * lets the slider draw a prefix of it — the crowd grows rather than rebuilding,
 * and the draw the reader is watching never changes shape.
 *
 * Bands are separated by an extra `gap`, so idlers, walkers and runners occupy
 * disjoint radial bands. The guarantee holds for any `footprint` at least the
 * robot's real width and any `gap` >= 0.
 */
export function layoutCrowd<C extends ClipRef>(
  clips: readonly C[],
  count: number,
  footprint: number,
  /**
   * Extra clear ground between bands, in footprints. The demo takes the
   * default; this stays a parameter rather than folding into a constant
   * because it is the spacing the guarantee is most sensitive to, and the test
   * sweeps it alongside `footprint` to show the guarantee is a property of the
   * construction and not of one lucky tuning. `0` still leaves one full
   * footprint (the ring step), so it holds at any value >= 0.
   */
  gap = 2,
  /** Which clip plays each band. The demo takes the robot's, where the names agree. */
  clipNames: BandClipNames = ROBOT_CLIP_NAMES,
): Robot<C>[] {
  const robots: Robot<C>[] = [];
  if (count <= 0) return robots;

  // Resolved up front: a missing clip would otherwise thin the crowd silently,
  // and "the count is the number of robots" is the one promise the demo makes.
  const clipFor = new Map<Band, C>();
  for (const band of BANDS) {
    const name = clipNames[band.clip];
    const clip = clips.find((c) => c.name === name);
    if (!clip) {
      const got = clips.map((c) => c.name).join(", ") || "none";
      throw new Error(`crowd layout needs a "${name}" clip for its ${band.label} band; got ${got}`);
    }
    clipFor.set(band, clip);
  }

  let i = 0;
  for (const ring of planRings(footprint, gap)) {
    // One speed for the whole ring (see property 3). Alternating direction
    // and a per-ring rate keep it from reading as a single rigid turntable —
    // rings never interact, so varying between them is free.
    const direction = ring.index % 2 === 0 ? 1 : -1;
    const rate = 0.85 + ((ring.index * 0.37) % 1) * 0.3;
    const omega = ring.radius > 0 ? (direction * ring.band.speed * rate) / ring.radius : 0;

    for (let k = 0; k < ring.slots; k++, i++) {
      if (i >= count) return robots;
      // Walkers/runners take the ring's rate so their feet match their ground
      // speed; idlers are in place, so theirs can vary freely.
      const playbackRate = ring.band.speed > 0 ? rate : 0.85 + hash(i, RATE) * 0.4;
      robots.push({
        clip: clipFor.get(ring.band)!,
        // Desync is a start time in the past, and it is free: it moves nobody.
        // Up to ten seconds *of clip* in, which is `10 / rate` seconds of wall
        // clock ago — the decode subtracts the start time before it scales by
        // the rate, so the division is what keeps a fast robot's spread the
        // same as a slow one's.
        startTime: (-hash(i, PHASE) * 10) / playbackRate,
        speed: playbackRate,
        radius: ring.radius,
        angle0: (k / ring.slots) * Math.PI * 2 + ring.index * 0.5,
        omega,
        heading: hash(i, HEADING) * Math.PI * 2,
      });
    }
  }
  return robots;
}

/** Where a robot stands at `time`, on the ground plane. */
export function positionAt(r: Robot<ClipRef>, time: number): { x: number; z: number } {
  const a = r.angle0 + r.omega * time;
  return { x: Math.cos(a) * r.radius, z: Math.sin(a) * r.radius };
}
