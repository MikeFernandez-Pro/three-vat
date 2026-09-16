// Crowd layout: where each robot stands, and how its ring turns.
//
// Kept free of three.js, the DOM *and* three-vat so the non-overlap guarantee
// below can be imported and tested directly rather than eyeballed in the
// browser. All it needs of a clip is its name, so it is generic over one.

/** The only thing the layout needs to know about a clip. */
export interface ClipRef {
  name: string;
}

// Three concentric zones: dancers hold the middle, walkers circle them, runners
// circle the walkers. Baking only these three clips is also the memory dial — a
// VAT costs `verts x frames x 16 B x 2` (two textures), so 7 214 verts at 30 fps
// is ~35 MB here; adding Wave (55 rows) and Idle (100) would push it past 60 MB.
export const ZONES = [
  { clip: "Dance", key: "dancers", speed: 0 },
  { clip: "Walking", key: "walkers", speed: 1.1 },
  { clip: "Running", key: "runners", speed: 3.4 },
] as const;

export type ZoneKey = (typeof ZONES)[number]["key"];

// Per-instance state. `clip`, `timeOffset` and `speed` go to the GPU once as
// instanced attributes and are never touched again; `radius`/`angle0`/`omega`
// are read by the CPU each frame to place the instance on the ground.
export interface Robot<C extends ClipRef = ClipRef> {
  clip: C;
  timeOffset: number; // playback phase (GPU)
  speed: number; // playback rate (GPU)
  /** Ring this instance belongs to, and where on it it started. */
  radius: number;
  angle0: number;
  /** Angular velocity, rad/s. Zero for the in-place dancers. */
  omega: number;
  /** Heading used when `omega` is 0. */
  heading: number;
}

/**
 * Lay the crowd out in concentric rings so that **no two robots ever overlap**,
 * for any elapsed time. Three properties give that guarantee outright, with no
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
 * Zones are separated by an extra gap, so dancers, walkers and runners occupy
 * disjoint radial bands. `footprint` and `zoneGap` are both live controls; the
 * guarantee holds for any `footprint` at least the robot's real width and any
 * `zoneGap` >= 0.
 */
export function layoutCrowd<C extends ClipRef>(
  clips: readonly C[],
  counts: Readonly<Record<ZoneKey, number>>,
  footprint: number,
  /**
   * Extra clear band between zones, in footprints. `0` still leaves one full
   * footprint (the ring step), so the guarantee holds at any value >= 0.
   */
  zoneGap = 2,
): Robot<C>[] {
  const robots: Robot<C>[] = [];
  let radius = 0;

  for (const zone of ZONES) {
    const count = counts[zone.key];
    const clip = clips.find((c) => c.name === zone.clip);
    if (!clip || count <= 0) continue;

    let remaining = count;
    let ring = 0;
    while (remaining > 0) {
      // At radius 0 the capacity formula gives 0; one robot stands dead centre.
      const capacity = Math.max(1, Math.floor((2 * Math.PI * radius) / footprint));
      const slots = Math.min(remaining, capacity);

      // One speed for the whole ring (see property 3). Alternating direction
      // and a per-ring rate keep it from reading as a single rigid turntable —
      // rings never interact, so varying between them is free.
      const direction = ring % 2 === 0 ? 1 : -1;
      const rate = 0.85 + ((ring * 0.37) % 1) * 0.3;
      const omega = radius > 0 ? (direction * zone.speed * rate) / radius : 0;

      for (let k = 0; k < slots; k++) {
        robots.push({
          clip,
          timeOffset: Math.random() * 10, // phase is free: it moves nobody
          // Walkers/runners take the ring's rate so their feet match their
          // ground speed; dancers are in place, so theirs can vary freely.
          speed: zone.speed > 0 ? rate : 0.85 + Math.random() * 0.4,
          radius,
          angle0: (k / slots) * Math.PI * 2 + ring * 0.5,
          omega,
          heading: Math.random() * Math.PI * 2,
        });
      }

      remaining -= slots;
      radius += footprint;
      ring++;
    }
    radius += footprint * zoneGap; // clear band between zones
  }
  return robots;
}

/** Where a robot stands at `time`, on the ground plane. */
export function positionAt(r: Robot<ClipRef>, time: number): { x: number; z: number } {
  const a = r.angle0 + r.omega * time;
  return { x: Math.cos(a) * r.radius, z: Math.sin(a) * r.radius };
}
