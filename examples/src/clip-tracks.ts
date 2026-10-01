// What a clip animates, kind by kind, and which kinds are moving right now.
//
// The vertex encoding page's evidence: the encoding records every kind of
// track alike, morph targets and node transforms, into the one texture, and
// these are the lines the HUD lights as each kind plays. Kept free of three.js
// so it runs in Node: a `THREE.KeyframeTrack` is one of these, read
// structurally.

/** A keyframe track, seen only as its binding and its keys. */
export interface KeyedTrack {
  /** `node.property`, as three binds it: `mesh_0.quaternion`, `Head_4.morphTargetInfluences`. */
  name: string;
  times: ArrayLike<number>;
  /** Every key's value, flat: as many numbers a key as the property takes. */
  values: ArrayLike<number>;
}

/** One kind of track in a clip, and whether it is moving at the moment asked about. */
export interface TrackKind {
  kind: string;
  /** How many of the clip's tracks are of this kind. */
  tracks: number;
  /** Whether one of them is between two keys that differ. */
  active: boolean;
}

/** The kinds by property: what a reader would call the motion a track makes. */
const KINDS: Record<string, string> = {
  morphTargetInfluences: "morph targets",
  quaternion: "node rotation",
  position: "node position",
  scale: "node scale",
};

/** The property a track binds, without the index a morph binding may carry. */
function propertyOf(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1).replace(/\[.*$/, "");
}

/** Whether a track's value changes over the span of keys `time` falls in. */
function movingAt({ times, values }: KeyedTrack, time: number): boolean {
  const stride = values.length / times.length;
  for (let key = 0; key + 1 < times.length; key++) {
    if (time < times[key]! || time >= times[key + 1]!) continue;
    for (let c = 0; c < stride; c++) {
      if (Math.abs(values[key * stride + c]! - values[(key + 1) * stride + c]!) > 1e-6) return true;
    }
    return false;
  }
  return false;
}

/**
 * The kinds of track a clip holds, in the order it first holds each, and which
 * are moving at `time`, in seconds into the clip.
 */
export function trackKinds(tracks: readonly KeyedTrack[], time: number): TrackKind[] {
  const kinds = new Map<string, TrackKind>();
  for (const track of tracks) {
    const property = propertyOf(track.name);
    const kind = KINDS[property] ?? property;
    const entry = kinds.get(kind) ?? { kind, tracks: 0, active: false };
    entry.tracks += 1;
    entry.active ||= movingAt(track, time);
    kinds.set(kind, entry);
  }
  return [...kinds.values()];
}
