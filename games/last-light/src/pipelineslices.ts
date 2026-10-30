// The scene drawn a slice at a time behind the loading screen, so its pipelines
// are built a few a frame (2026-10-27). Chrome's GPU process compiles a
// pipeline the first time a frame draws with it, and shows no frame of the
// page at all until it is done: drawn whole, the goose game stood ten seconds
// with nothing on screen, no count on a loading screen either. A slice a frame,
// each frame builds a couple and is shown, and the loading screen counts them.
import type { Material, Object3D } from 'three/webgpu'

/** What three draws, and so builds a pipeline for: a mesh, instanced or batched, points, a line, a sprite. */
function drawn(object: Object3D): boolean {
  const o = object as Partial<Record<'isMesh' | 'isPoints' | 'isLine' | 'isSprite', boolean>>
  return !!(o.isMesh || o.isPoints || o.isLine || o.isSprite)
}

/**
 * Which pipelines `object` is drawn with, as a key, as three r187 keys them
 * (RenderObject.getMaterialCacheKey): those of its materials, shared with
 * whatever else wears them; an instanced mesh's shared with every other in
 * those materials whose instance data is of its kind; a batched mesh's, or
 * any other object drawn more than once, its own.
 */
export function pipelineKey(object: Object3D): string {
  const { material } = object as Object3D & { material?: Material | Material[] }
  const materials = (Array.isArray(material) ? material : material ? [material] : []).map((m) => m.uuid).join(',')
  const o = object as Object3D & { isInstancedMesh?: boolean; isBatchedMesh?: boolean; count?: number; instanceColor?: unknown; morphTexture?: unknown }
  if (o.isBatchedMesh) return `${materials}/${object.uuid}`
  if (o.isInstancedMesh) return `${materials}/instanced${o.instanceColor ? '+colour' : ''}${o.morphTexture ? '+morph' : ''}`
  return (o.count ?? 1) > 1 ? `${materials}/${object.uuid}` : materials
}

/** The scene's drawn objects, hidden or not, in slices of a few pipelines each. */
export class PipelineSlices {
  /** Each slice's objects: every object of `perSlice` keys. */
  readonly slices: readonly (readonly Object3D[])[]
  private readonly all: Object3D[] = []

  /** Every object drawn under `root` as it now stands, `perSlice` pipeline keys to a slice, in the order first met. */
  constructor(root: Object3D, perSlice: number) {
    const byKey = new Map<string, Object3D[]>()
    root.traverse((object) => {
      if (!drawn(object)) return
      this.all.push(object)
      const key = pipelineKey(object)
      const same = byKey.get(key)
      if (same) same.push(object)
      else byKey.set(key, [object])
    })
    const groups = [...byKey.values()]
    const slices: Object3D[][] = []
    for (let i = 0; i < groups.length; i += perSlice) slices.push(groups.slice(i, i + perSlice).flat())
    this.slices = slices
  }

  /** Hide every drawn object but slice `k`'s, all of them if there is no slice `k`; the function returned puts each back as it was. */
  only(k: number): () => void {
    const kept = new Set(this.slices[k] ?? [])
    const shown = this.all.map((object) => object.visible)
    for (const object of this.all) object.visible &&= kept.has(object)
    return () => this.all.forEach((object, i) => (object.visible = shown[i]!))
  }
}
