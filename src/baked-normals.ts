// Which materials need a baked normal, and what to say when one is handed a VAT
// that has none.
//
// Lives in core rather than in either renderer subpath for the reason ADR-0009
// gives about the instance-playback contract: a rule with two definitions drifts
// the first time a material class is added to it. It imports no `three` *value*,
// so ADR-0005's bundle isolation is untouched — it reads the `isMeshXxxMaterial`
// flags three's own classes carry, which the node twins inherit too (three's
// `NodeMaterial.setDefaultValues` copies every own property off a default
// instance of the classic class, that flag included).
import type { Material } from 'three'
import type { VAT } from './types.js'

/**
 * The material classes whose shading reads a normal. `MeshPhysicalMaterial`
 * extends `MeshStandardMaterial` and sets its flag too, so it is covered here.
 *
 * `MeshNormalMaterial` and `MeshMatcapMaterial` are not lit, but they read the
 * normal as directly as anything can, so a rest-pose one is just as visible.
 */
const NORMAL_READING_FLAGS = [
  'isMeshStandardMaterial',
  'isMeshPhongMaterial',
  'isMeshLambertMaterial',
  'isMeshToonMaterial',
  'isMeshNormalMaterial',
  'isMeshMatcapMaterial',
] as const

/**
 * Would this material read a baked normal if there were one?
 *
 * `flatShading: true` is the way out, and the *better* way: three then derives
 * the normal from screen-space derivatives of the deformed position, per
 * fragment, which is the correct normal for the posed mesh and costs the bake
 * nothing. `MeshToonMaterial` has no `flatShading` at all, so it always needs a
 * baked normal — which is exactly why the check is per class and not just
 * "does it have `flatShading: false`".
 */
export function needsBakedNormal(material: Material): boolean {
  if ((material as { flatShading?: boolean }).flatShading === true) return false
  const flags = material as unknown as Record<string, unknown>
  return NORMAL_READING_FLAGS.some((flag) => flags[flag] === true)
}

/**
 * Refuse a pairing that would light a crowd by its rest pose.
 *
 * A VAT baked with `bakeNormals: false` carries positions only. Rendering a
 * smooth-shaded lit material against it is the failure `bakeVAT` exists to
 * prevent — ADR-0002: "normals must be baked too, lighting is visibly wrong
 * otherwise" — and it is silent, because the geometry still has a rest normal
 * for three to happily shade with. So it is a throw, naming both fixes.
 */
export function assertBakedNormal(vat: VAT, material: Material): void {
  // Only the vertex encoding can lack a normal — a rig-encoded VAT shades from
  // its skin matrix (ADR-0018) — so the check narrows on the encoding first.
  if (vat.encoding !== 'delta' || vat.normalTexture !== null || !needsBakedNormal(material)) return
  throw new Error(
    `three-vat: material "${material.name || '(unnamed)'}" (${material.type}) shades from a normal, but this VAT ` +
      'was baked with `bakeNormals: false` and carries none — the crowd would be lit by its rest pose. ' +
      'Set `flatShading: true` on the material (three then derives the normal from the deformed position, ' +
      'per fragment, which is the right normal for a posed mesh), or use an unlit material such as ' +
      'MeshBasicMaterial, or bake with `bakeNormals: true`.',
  )
}
