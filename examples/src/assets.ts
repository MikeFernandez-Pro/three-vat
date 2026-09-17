// The demo's asset: RobotExpressive, loaded and measured. Shared across pages —
// a glTF is a glTF whichever renderer draws it, and the loader is renderer-
// agnostic (ADR-0011).
//
// What is *not* here: the bake. `bakeVAT` wants this GPU's real maximum texture
// size, and reading that means holding a renderer — so each page bakes its own,
// one line, in plain sight.
import { Vector3 } from "three";
import type { AnimationClip, Box3, Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ZONES } from "./crowd.js";

/** World units, so the crowd reads at human scale whatever the model ships as. */
export const TARGET_HEIGHT = 1.8;

/**
 * Relative, not `/RobotExpressive.glb`: the pages sit side by side at the root
 * of the app, so a relative URL keeps working when the whole app is served from
 * a subpath (GitHub Pages) rather than a domain root. Exported so that promise
 * is asserted against the value rather than against this file's text
 * (`deploy.test.ts`).
 */
export const MODEL_URL = "RobotExpressive.glb";

/** The clips the crowd actually uses — one per zone, and no more (see ZONES). */
const CLIP_NAMES: string[] = ZONES.map((z) => z.clip);

export interface RobotAsset {
  /** The posed subtree to bake: 14 rigid, node-animated parts (ADR-0008). */
  root: Object3D;
  clips: AnimationClip[];
}

/**
 * Load the robot and hand back the subtree to bake, world matrices up to date.
 *
 * The URL is a parameter only because {@link MODEL_URL} is relative and not
 * every page sits at the root of the app — the parity gate lives one directory
 * down and reaches back up for the same file. The demos take the default.
 *
 * Only the zone clips come back. Baking is the memory dial — a VAT costs
 * `verts x frames x 16 B x 2` — so the demo bakes three clips, not all nine.
 */
export async function loadRobot(url: string = MODEL_URL): Promise<RobotAsset> {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  return {
    root: gltf.scene,
    clips: gltf.animations.filter((c) => CLIP_NAMES.includes(c.name)),
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
