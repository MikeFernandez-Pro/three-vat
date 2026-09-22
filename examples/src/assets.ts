// The pages' assets, loaded and measured: the demo's RobotExpressive, and the
// example's Soldier (ADR-0019). Shared across pages — a glTF is a glTF
// whichever renderer draws it, and the loader is renderer-agnostic (ADR-0011).
//
// What is *not* here: the bake. `bakeVAT` wants this GPU's real maximum texture
// size, and reading that means holding a renderer — so each page bakes its own,
// one line, in plain sight.
import { Vector3 } from "three";
import type { AnimationClip, Box3, Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { BandClipNames } from "./crowd.js";

/** World units, so the crowd reads at human scale whatever the model ships as. */
export const TARGET_HEIGHT = 1.8;

/**
 * Relative, not `/RobotExpressive.glb`: the pages sit side by side at the root
 * of the app, so a relative URL keeps working when the whole app is served from
 * a subpath (GitHub Pages) rather than a domain root. Exported so that promise
 * is asserted against the value rather than against this file's text
 * (`release/packaging/deploy.test.ts`).
 */
export const MODEL_URL = "RobotExpressive.glb";

/**
 * The clips to bake, and no more. Baking is the memory dial — a VAT costs
 * `verts x frames x 16 B x 2` — so the demo bakes three of RobotExpressive's
 * nine, not all nine.
 *
 * Stated here rather than read off the crowd layout: what a page loads is the
 * asset module's business, and the layout is free to pick from what it is
 * handed. The two lists are tied only by name — `crowd.ts` throws if a clip it
 * needs is missing, so a list that drifts fails loudly at the first build.
 */
const CLIP_NAMES = ["Idle", "Walking", "Running"];

/** A loaded character: what a page bakes. */
export interface CharacterAsset {
  /** The posed subtree to bake, world matrices up to date. */
  root: Object3D;
  /** The clips to bake, and no more. */
  clips: AnimationClip[];
}

/**
 * Load the robot and hand back the subtree to bake, world matrices up to date.
 *
 * The URL is a parameter only because {@link MODEL_URL} is relative and not
 * every page that loads this robot sits at the root of the app — the release
 * suite's parity gate serves it from `release/` and reaches back up for the same
 * file. The demos take the default.
 *
 * Only the clips named above come back. The subtree is 14 rigid, node-animated
 * parts (ADR-0008).
 */
export async function loadRobot(url: string = MODEL_URL): Promise<CharacterAsset> {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  return {
    root: gltf.scene,
    clips: gltf.animations.filter((c) => CLIP_NAMES.includes(c.name)),
  };
}

// ---------------------------------------------------------------- Soldier
// The example's asset (ADR-0019): three.js's Soldier, a 49-bone skinned
// character of 7 434 vertices — the one the rig encoding was measured on
// (ADR-0018's table), and the real asset the library's own suite pins its rig
// bake against. Committed beside the robot rather than fetched on demand, as
// the test suite's copy is (docs/test-assets.md), because the deployed example
// loads it and the Pages build copies `public/` and nothing else.

/** Relative, for the same reason {@link MODEL_URL} is. */
export const SOLDIER_URL = "Soldier.glb";

/**
 * Which of Soldier's clips plays each band: it walks in `Walk` where the robot
 * walks in `Walking`. `TPose`, its fourth clip, is left out — the rig's rest
 * pose *is* its T-pose, so it bakes as a frozen row and would stand a crowd
 * still.
 */
export const SOLDIER_CLIP_NAMES: BandClipNames = { Idle: "Idle", Walking: "Walk", Running: "Run" };

/**
 * Soldier is authored facing −z; the crowd layout faces a mover along its
 * travel assuming +z, as the robot is authored, so a Soldier is turned half a
 * circle on top of that. The parity gate turns its Soldiers the same way.
 */
export const SOLDIER_YAW = Math.PI;

/**
 * Load Soldier and hand back the subtree to bake, world matrices up to date —
 * the three moving clips only, as {@link SOLDIER_CLIP_NAMES} lists them.
 */
export async function loadSoldier(url: string = SOLDIER_URL): Promise<CharacterAsset> {
  const wanted = Object.values(SOLDIER_CLIP_NAMES);
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  return {
    root: gltf.scene,
    clips: gltf.animations.filter((c) => wanted.includes(c.name)),
  };
}

/**
 * Scale and footprint for a crowd of this VAT, from its baked bounds.
 *
 * The bounds already cover every frame of every clip, so the footprint accounts
 * for the widest moment of the widest animation (arms out mid-dance) rather
 * than the rest pose — which is what makes the layout's non-overlap guarantee
 * true of the *animated* crowd and not just of its rest poses.
 */
export function crowdScale(bounds: Box3): { scale: number; footprint: number } {
  const size = bounds.getSize(new Vector3());
  const scale = TARGET_HEIGHT / size.y;
  return { scale, footprint: Math.max(size.x, size.z) * scale };
}
