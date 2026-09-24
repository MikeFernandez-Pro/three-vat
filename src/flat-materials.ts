// `mergeFlatMaterials` (ADR-0028): materials that differ only in a flat colour
// collapse into one, and the colour moves into the vertices. What decides a
// merge lives here, apart from the bake, because the page and a worker read it
// differently — the page from real materials, a worker from facts the page
// sent, since a material does not cross a message (ADR-0026).
import { Color } from 'three'
import type { Material } from 'three'

/**
 * What a merge reads off one material: the key two materials must share to
 * collapse — every property but the colour — and the colour itself, in the
 * working colour space three stores it in, which is the space a vertex colour
 * is read in too.
 */
export interface FlatFacts {
  key: string
  color: [number, number, number]
}

/** The properties a merge ignores: the colour it moves into the vertices, and what names a material rather than shading it. */
const IGNORED = ['uuid', 'name', 'color', 'userData', 'metadata'] as const

/**
 * A material's facts, or `null` when it is not **flat**: when it has no
 * `color`, reads vertex colours already, or holds a texture of any kind — a
 * map, a normal map, an environment map. A texture varies across the surface,
 * and one colour per part cannot stand in for it.
 *
 * Nor is it flat when `color` is not what it draws, or the key cannot see all
 * of what it draws (#79): a `ShadowMaterial`, whose shader reads no vertex
 * colour; a node material with any node input, which can replace `color` or
 * hold a texture no own property shows; and a material whose shader a
 * caller hooked, since `toJSON` serializes no hook and `clone` copies none.
 */
export function flatFacts(material: Material): FlatFacts | null {
  const m = material as Material & {
    color?: Color
    vertexColors?: boolean
    isShadowMaterial?: boolean
  }
  if (!m.color?.isColor || m.vertexColors || m.isShadowMaterial) return null
  // A caller's hook is an own property; a subclass's own is on its prototype.
  const own = (key: string) => Object.prototype.hasOwnProperty.call(m, key)
  if (own('onBeforeCompile') || own('customProgramCacheKey')) return null
  for (const value of Object.values(m)) {
    const v = value as { isTexture?: boolean; isNode?: boolean } | null
    // A node input — `colorNode`, `outputNode`, `emissiveNode` — can replace or
    // texture what the material draws where no own property shows it.
    if (v?.isTexture || v?.isNode) return null
  }
  const json = m.toJSON() as unknown as Record<string, unknown>
  for (const key of IGNORED) delete json[key]
  return { key: JSON.stringify(json), color: [m.color.r, m.color.g, m.color.b] }
}

/**
 * The material a merge draws with: a clone of the first member, white, reading
 * its colour from the vertices. White because three multiplies the material
 * colour by the vertex colour, so white passes each part's own through.
 */
export function mergedFlatMaterial(members: Material[]): Material {
  const merged = members[0]!.clone() as Material & { color: Color; vertexColors: boolean }
  merged.color.setRGB(1, 1, 1)
  merged.vertexColors = true
  merged.name = members
    .map((m) => m.name)
    .filter(Boolean)
    .join(' + ')
  return merged
}

/** How a merge reads materials and builds the merged one: the page's own functions, or a worker's stand-ins for them. */
export interface FlatMergeHooks {
  facts(material: Material): FlatFacts | null
  merge(members: Material[]): Material
}

export const FLAT_MERGE: FlatMergeHooks = { facts: flatFacts, merge: mergedFlatMaterial }

/** A planned merge: where each merged material went, and the colour it left behind. */
export interface FlatMerge {
  targetOf(material: Material): { material: Material; tint: Color } | undefined
}

/**
 * Plan the merge over a subtree's materials, in the order they were met. Only a
 * group of two or more collapses: a flat material alone has no draw call to
 * save, and is left exactly as it was rather than swapped for a clone.
 */
export function planFlatMerge(materials: Material[], hooks: FlatMergeHooks): FlatMerge {
  const facts = new Map<Material, FlatFacts>()
  const groups = new Map<string, Material[]>()
  for (const material of materials) {
    if (facts.has(material)) continue
    const f = hooks.facts(material)
    if (!f) continue
    facts.set(material, f)
    groups.set(f.key, [...(groups.get(f.key) ?? []), material])
  }

  const targets = new Map<Material, { material: Material; tint: Color }>()
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const merged = hooks.merge(members)
    for (const m of members) targets.set(m, { material: merged, tint: new Color().fromArray(facts.get(m)!.color) })
  }
  return { targetOf: (material) => targets.get(material) }
}
