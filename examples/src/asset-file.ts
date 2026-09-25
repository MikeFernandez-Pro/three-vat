// A dropped asset, read from its bytes: what the drop pages bake. Shared by
// both pages, like assets.ts beside it — a loader is renderer-agnostic, and a
// glTF is a glTF whichever renderer draws it (ADR-0011).
//
// The bytes are the browser's own copy of the visitor's file. Nothing here, or
// anywhere on the page, sends them anywhere: the loaders parse in memory.
import type { AnimationClip, Object3D } from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { CharacterAsset } from "./assets.js";
import type { AssetFormat } from "./drop.js";

/**
 * Parse an asset's bytes in the format the drop resolved, and hand back the
 * subtree to bake, world matrices up to date, with every clip it carries.
 *
 * Throws what the loader throws: the page shows that message and keeps the
 * crowd it had.
 */
export async function parseAsset(bytes: ArrayBuffer, format: AssetFormat): Promise<CharacterAsset> {
  let root: Object3D;
  let clips: AnimationClip[];
  if (format === "fbx") {
    root = new FBXLoader().parse(bytes, "");
    clips = root.animations;
  } else {
    const gltf = await new GLTFLoader().parseAsync(bytes, "");
    root = gltf.scene;
    clips = gltf.animations;
  }
  root.updateMatrixWorld(true);
  return { root, clips };
}
