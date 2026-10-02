// Make a WebGL post-processing pass draw a VAT crowd's pose, not its rest pose.
//
// three's passes that need the scene's depth, or a mask of what is selected,
// draw the scene again under a material of their own, `scene.overrideMaterial`:
// `BokehPass` its depth material, `OutlinePass` a depth material and then a
// mask `ShaderMaterial`, `SSAOPass` normals and depth. That material knows
// nothing of the VAT, so it draws the geometry as baked: the rest pose,
// standing still where the crowd runs.
//
// The fix, for as long as each of those renders lasts: every crowd draws a
// VAT-patched copy of whichever material the pass put on the scene, with
// `allowOverride` off so three draws the copy rather than the override over
// it, and gets its own materials back the moment the render ends. The scene's
// render hooks are where that goes, because WebGLRenderer calls them around
// every render, after the pass has set its material and before it picks one
// for each object.
//
// Not a library function, because a pass's override is three's own business:
// which material a pass draws with, and when, is a private detail that can
// change between releases (docs/usage.md, "Post-processing").
//
// Two ways to get it wrong, both avoided here:
//
// - Patching the pass's own material in place. Every mesh in the scene draws
//   with it, so the floor would run the decode too.
// - A `ShaderMaterial` copy with uniforms of its own. The pass writes into its
//   material's uniforms every frame (OutlinePass the depth texture it just
//   drew), so the copy takes the very same uniforms. Each in a fresh object,
//   though, not the pass's object itself: the patch binds the crowd's own
//   playback on it, and two crowds sharing one would both draw the second's.
import type { Material, Scene, ShaderMaterial } from "three";
import type { VAT, VATCrowd } from "three-vat";
import { patchVATMaterial } from "three-vat/webgl";

/** The fix, switchable: a page's "fix on/off". */
export interface PassOverrideFix {
  enabled: boolean;
}

/** A VAT-patched copy of a pass's override material, for one crowd. */
function copyFor(override: Material, vat: VAT, crowd: VATCrowd): Material {
  const shader = override as ShaderMaterial;
  // clone() deep-copies a ShaderMaterial's uniforms, which the pass would go on
  // writing into the originals of — and warns at the render target's texture
  // it cannot copy. So the pass's material lends the copy no uniforms for
  // the length of the clone (its own are put straight back), and the copy
  // shares each of the pass's uniforms, in an object of its own.
  const uniforms = shader.isShaderMaterial ? shader.uniforms : null;
  if (uniforms) shader.uniforms = {};
  const copy = override.clone();
  if (uniforms) {
    shader.uniforms = uniforms;
    (copy as ShaderMaterial).uniforms = { ...uniforms };
  }
  copy.allowOverride = false;
  return patchVATMaterial(copy, vat, { uVatTime: crowd.time }, crowd.playback);
}

/**
 * Make every pass that draws `scene` under a material of its own draw `crowds`
 * posed. Each crowd decodes `vat`.
 */
export function followThePose(scene: Scene, vat: VAT, crowds: readonly VATCrowd[]): PassOverrideFix {
  const fix: PassOverrideFix = { enabled: true };
  // One copy per crowd per override material, made the first time a pass draws
  // with it, so nothing is compiled twice.
  const copies = new Map<Material, Material[]>();
  // The crowds' own materials, while a pass's copies stand in for them.
  let own: VATCrowd["mesh"]["material"][] | null = null;

  const before = scene.onBeforeRender.bind(scene);
  const after = scene.onAfterRender.bind(scene);

  scene.onBeforeRender = (...args) => {
    before(...args);
    const override = scene.overrideMaterial;
    if (!fix.enabled || override === null) return;
    let copy = copies.get(override);
    if (!copy) copies.set(override, (copy = crowds.map((crowd) => copyFor(override, vat, crowd))));
    own = crowds.map(({ mesh }) => mesh.material);
    crowds.forEach(({ mesh }, i) => (mesh.material = copy[i]!));
  };

  scene.onAfterRender = (...args) => {
    if (own) crowds.forEach(({ mesh }, i) => (mesh.material = own![i]!));
    own = null;
    after(...args);
  };

  return fix;
}
