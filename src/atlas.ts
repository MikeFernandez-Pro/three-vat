// The **atlas** (ADR-0040): several bakes side by side in one VAT, so that one
// material samples every character and one `BatchedMesh` draws them all.
//
// In core, beside the bake, because it copies texels the `VAT` contract keeps
// opaque — the rig's slots and the hierarchy row's parents, the half-floats and
// octahedral pairs of the vertex layers — and only the code that writes them
// may read them. The decode does not change: a character's columns are its
// rebased `skinIndex` under the rig encoding and its batch vertex index under
// the vertex encoding, and its rows are its own clips', which start at row 0
// as they did on its own VAT.
import { Box3, BufferAttribute, BufferGeometry, HalfFloatType } from 'three'
import { RIG_HIERARCHY_TEXELS, RIG_TEXELS_PER_SLOT } from './rig-texture.js'
import type { DeltaVAT, RigVAT, VAT, VATCharacterRange, VATClip } from './types.js'
import { boundedBy, characterRange, indexOf } from './batch-geometry.js'
import { addFrame } from './instance-bounds.js'
import { makeVATNormalTexture, makeVATTexture, MAX_TEXTURE_SIZE } from './vat-texture.js'

/** One character in an atlas: where it sits, the geometry to add for it, and its own clips. */
export interface VATAtlasCharacter extends VATCharacterRange {
  /**
   * The geometry to add to the batch for this character, in the atlas's order:
   * the attributes every character shares, an index, its `skinIndex` rebased
   * onto its slots under the rig encoding, and its own all-frames bounds,
   * which the batch culls its instances by.
   */
  geometry: BufferGeometry
  /**
   * Its clips, as its own VAT had them, `startFrame`s and all. Write one of
   * them into one of its instances with `setVATInstance`, exactly as on its
   * own VAT.
   */
  clips: VATClip[]
}

/** What {@link composeVATAtlas} returns: an atlas on the encoding `V` of the bakes it was made from. */
export interface VATAtlas<V extends VAT = VAT> {
  /** The atlas, as the decode sees one VAT: hand it to `patchVATMaterial` or `vatNodes` with the batch. */
  vat: V
  /** One per bake, in the order given: the order to add their geometries in. */
  characters: VATAtlasCharacter[]
}

/** Options for {@link composeVATAtlas}. */
export interface ComposeVATAtlasOptions {
  /**
   * The texture ceiling the atlas must fit, as for `bakeVAT`: pass
   * `getMaxTextureSize(renderer)` from `three-vat/webgl` or `three-vat/tsl`.
   * Defaults to {@link MAX_TEXTURE_SIZE}.
   */
  maxTextureSize?: number
}

/**
 * Compose several bakes into one **atlas**: one VAT that one material samples
 * every character from, and one geometry a character to add to a
 * `BatchedMesh`, in the order given (ADR-0040).
 *
 * Characters sit side by side. Under the rig encoding each one's slots start
 * after the slots before it, its geometry's `skinIndex` is rebased to match,
 * and so is each parent in the hierarchy row, which stays the last row. Under
 * the vertex encoding each one's columns start at the sum of the vertex counts
 * before it, both layers together, and the batch's own vertex index lands on
 * them only if its geometries go in in this order, contiguous — which the
 * carrier rule checks. Every character's bands start at row 0, so no clip
 * moves: the atlas is as tall as its tallest character, and the rows below a
 * shorter one are padding.
 *
 * An atlas holds one encoding, and a mix is refused. So is an atlas wider than
 * `maxTextureSize`. Under the vertex encoding the width is every vertex, and
 * the refusal names the character that does not fit: one as wide as Michelle's
 * 16 340 vertices shares a vertex atlas with nobody at 16 384. Under the
 * vertex encoding every character carries normals or none does, and each
 * takes one row a frame.
 *
 * Characters lose their own materials: a batch takes one. Colour them
 * per instance with `BatchedMesh.setColorAt`.
 */
export function composeVATAtlas(vats: readonly RigVAT[], options?: ComposeVATAtlasOptions): VATAtlas<RigVAT>
export function composeVATAtlas(vats: readonly DeltaVAT[], options?: ComposeVATAtlasOptions): VATAtlas<DeltaVAT>
export function composeVATAtlas(vats: readonly VAT[], options?: ComposeVATAtlasOptions): VATAtlas
export function composeVATAtlas(vats: readonly VAT[], { maxTextureSize = MAX_TEXTURE_SIZE }: ComposeVATAtlasOptions = {}): VATAtlas {
  if (vats.length === 0) throw new Error('three-vat: an atlas composes at least one bake, and was given none')
  const leveled = vats.findIndex((vat) => vat.lods)
  if (leveled >= 0) {
    throw new Error(
      `three-vat: character ${leveled} already has levels of detail, which an atlas would drop. ` +
        'Compose the atlas from the bakes, then make its levels with createVATLODs, one list a character.',
    )
  }
  assertOneEncoding(vats)
  if (vats[0]!.encoding === 'rig') return composeRig(vats as readonly RigVAT[], maxTextureSize)
  return composeVertex(vats as readonly DeltaVAT[], maxTextureSize)
}

/**
 * One encoding per atlas: the two decodes are different programs over
 * different attributes, and a material compiles one of them.
 */
function assertOneEncoding(vats: readonly VAT[]): void {
  if (vats.every((vat) => vat.encoding === vats[0]!.encoding)) return
  const named = vats.map((vat, k) => {
    if (vat.encoding === 'rig') return `character ${k} is on the rig encoding`
    return `character ${k} on the vertex encoding${vat.fallback ? ` (${vat.fallback})` : ''}`
  })
  throw new Error(
    `three-vat: an atlas holds one encoding, and these bakes mix them: ${named.join(', ')}. ` +
      'The two decodes are different programs and a material compiles one of them, so a character the rig ' +
      'refuses puts the whole atlas on the vertex encoding.',
  )
}

/**
 * The ceiling holds the atlas's height as it holds its width. Each bake was
 * checked against the ceiling it was made at, and the atlas may be composed
 * for a smaller one — a phone's — so its tallest character's rows are checked
 * again here, before a texture that fails at upload is built.
 */
function assertHeight(vats: readonly VAT[], height: number, rows: string, maxTextureSize: number): void {
  if (height <= maxTextureSize) return
  const tallest = vats.findIndex((vat) => vat.totalFrames === Math.max(...vats.map((v) => v.totalFrames)))
  throw new Error(
    `three-vat: atlas height ${height} (${rows}, as tall as its tallest character) exceeds maxTextureSize ` +
      `${maxTextureSize}: character ${tallest} is the tallest — bake it at this ceiling, with a lower fps or fewer clips`,
  )
}

function composeRig(vats: readonly RigVAT[], maxTextureSize: number): VATAtlas<RigVAT> {
  const slotCount = vats.reduce((n, vat) => n + vat.slotCount, 0)
  const width = slotCount * RIG_TEXELS_PER_SLOT
  if (width > maxTextureSize) {
    throw new Error(
      `three-vat: atlas width ${width} (${slotCount} slots × ${RIG_TEXELS_PER_SLOT} texels, ` +
        `${vats.map((vat) => vat.slotCount).join(' + ')} by character) exceeds maxTextureSize ${maxTextureSize}`,
    )
  }
  const totalFrames = Math.max(...vats.map((vat) => vat.totalFrames))
  assertHeight(vats, totalFrames + 1, 'its bands and the hierarchy row', maxTextureSize)
  const data = new Float32Array(width * (totalFrames + 1) * 4)
  const shared = sharedAttributes(vats)

  const characters: VATAtlasCharacter[] = []
  let vertexStart = 0
  let slotStart = 0
  for (const vat of vats) {
    const own = vat.slotCount * RIG_TEXELS_PER_SLOT
    const src = vat.rigTexture.image.data as Float32Array
    const x0 = slotStart * RIG_TEXELS_PER_SLOT
    // The bands, row for row, from row 0.
    for (let y = 0; y < vat.totalFrames; y++) {
      data.set(src.subarray(y * own * 4, (y + 1) * own * 4), (y * width + x0) * 4)
    }
    // The hierarchy row, last: each parent rebased onto the atlas's slots.
    const hierarchy = src.slice(vat.totalFrames * own * 4, (vat.totalFrames + 1) * own * 4)
    for (let s = 0; s < vat.slotCount; s++) {
      const parent = (s * RIG_TEXELS_PER_SLOT + RIG_HIERARCHY_TEXELS.pivot) * 4 + 3
      if (hierarchy[parent]! >= 0) hierarchy[parent]! += slotStart
    }
    data.set(hierarchy, (totalFrames * width + x0) * 4)

    characters.push({ geometry: characterGeometry(vat, shared, slotStart), clips: vat.clips, ...characterRange(vat, vertexStart, slotStart) })
    vertexStart += vat.vertexCount
    slotStart += vat.slotCount
  }

  const vat: RigVAT = {
    encoding: 'rig',
    rigTexture: makeVATTexture(data, width, totalFrames + 1),
    slotCount,
    ...atlasFields(vats, characters, totalFrames),
  }
  return { vat, characters }
}

function composeVertex(vats: readonly DeltaVAT[], maxTextureSize: number): VATAtlas<DeltaVAT> {
  vats.forEach((vat, k) => {
    if (vat.rowsPerFrame === 1) return
    throw new Error(
      `three-vat: character ${k} spans ${vat.rowsPerFrame} rows a frame, and a vertex atlas puts each character's ` +
        'frame on one row beside the others — its vertices alone are past the ceiling it was baked at (ADR-0030), ' +
        'so it cannot share a vertex atlas',
    )
  })
  assertNormalsOnAllOrNone(vats)

  const width = vats.reduce((n, vat) => n + vat.vertexCount, 0)
  if (width > maxTextureSize) {
    let end = 0
    const misfit = vats.findIndex((vat) => (end += vat.vertexCount) > maxTextureSize)
    throw new Error(
      `three-vat: atlas width ${width} (${vats.map((vat) => vat.vertexCount).join(' + ')} vertices by character) ` +
        `exceeds maxTextureSize ${maxTextureSize}: character ${misfit} does not fit beside the ones before it. ` +
        'The vertex encoding is a column a vertex; the rig encoding is two a slot, where the rig takes them',
    )
  }
  const totalFrames = Math.max(...vats.map((vat) => vat.totalFrames))
  assertHeight(vats, totalFrames, 'its bands', maxTextureSize)
  // Rows below a shorter character are zero: a delta of nothing, its rest pose,
  // which none of its clips reaches.
  const positions = new Uint16Array(width * totalFrames * 4)
  const normals = vats[0]!.normalTexture ? new Uint8Array(width * totalFrames * 2) : null
  const shared = sharedAttributes(vats)

  const characters: VATAtlasCharacter[] = []
  let vertexStart = 0
  for (const vat of vats) {
    const n = vat.vertexCount
    const position = vat.positionTexture.image.data as Uint16Array
    const normal = vat.normalTexture?.image.data as Uint8Array | undefined
    for (let y = 0; y < vat.totalFrames; y++) {
      positions.set(position.subarray(y * n * 4, (y + 1) * n * 4), (y * width + vertexStart) * 4)
      normals?.set(normal!.subarray(y * n * 2, (y + 1) * n * 2), (y * width + vertexStart) * 2)
    }
    characters.push({ geometry: characterGeometry(vat, shared, 0), clips: vat.clips, ...characterRange(vat, vertexStart, 0) })
    vertexStart += n
  }

  const fallbacks = vats.flatMap((vat, k) => (vat.fallback ? [`character ${k}: ${vat.fallback}`] : []))
  const vat: DeltaVAT = {
    encoding: 'delta',
    positionTexture: makeVATTexture(positions, width, totalFrames, HalfFloatType),
    normalTexture: normals ? makeVATNormalTexture(normals, width, totalFrames) : null,
    rowsPerFrame: 1,
    fallback: fallbacks.length > 0 ? fallbacks.join('; ') : null,
    ...atlasFields(vats, characters, totalFrames),
  }
  return { vat, characters }
}

/**
 * Both layers are composed together: a material decodes the normal layer for
 * every vertex it draws or for none, so an atlas carries one for every
 * character or for none.
 */
function assertNormalsOnAllOrNone(vats: readonly DeltaVAT[]): void {
  const have = vats.flatMap((vat, k) => (vat.normalTexture ? [k] : []))
  if (have.length === 0 || have.length === vats.length) return
  const lack = vats.flatMap((vat, k) => (vat.normalTexture ? [] : [k]))
  const list = (ks: number[]) =>
    ks.length === 1 ? `character ${ks[0]}` : `characters ${ks.slice(0, -1).join(', ')} and ${ks[ks.length - 1]}`
  throw new Error(
    `three-vat: a vertex atlas carries normals in every character or in none, and ${list(have)} ` +
      `${have.length > 1 ? 'have them' : 'has them'} where ${list(lack)} ${lack.length > 1 ? 'have none' : 'has none'} ` +
      '(baked with bakeNormals: false). A material decodes the normal layer for every vertex it draws or for none — ' +
      'bake them all the same way',
  )
}

/**
 * What a character that lacks an attribute another carries is given, as the
 * bake writes it (a float, at this size): `color` in white, so the batch's
 * colour is the instance's; `uv` at zero, read by no map of its own; a
 * `tangent` along x, a frame a normal map can turn by. Filled rather than
 * dropped, because a batch takes one material, and a textured one needs the
 * textured character's own uv on every geometry it draws.
 */
const FILLERS: Readonly<Record<string, readonly number[]>> = { color: [1, 1, 1], uv: [0, 0], tangent: [1, 0, 0, 1] }

/**
 * The attributes a batch can hold for every character: the ones they all
 * carry, and each fillable one any of them carries, which the others are
 * given ({@link FILLERS}). Read off every character, never the first alone,
 * so the order they are given in does not decide what survives. A batch
 * refuses a geometry missing one its first geometry has.
 */
function sharedAttributes(vats: readonly VAT[]): string[] {
  const names = [...new Set(vats.flatMap((vat) => Object.keys(vat.geometry.attributes)))]
  return names.filter((name) => name in FILLERS || vats.every((vat) => vat.geometry.hasAttribute(name)))
}

/** One character's geometry for the batch. */
function characterGeometry(vat: VAT, attributes: readonly string[], slotStart: number): BufferGeometry {
  const source = vat.geometry
  const geometry = new BufferGeometry()
  for (const name of attributes) {
    if (name === 'skinIndex') {
      const index = source.getAttribute('skinIndex')
      const rebased = new Uint16Array(index.count * 4)
      for (let i = 0; i < rebased.length; i++) rebased[i] = index.getComponent(Math.floor(i / 4), i % 4) + slotStart
      geometry.setAttribute('skinIndex', new BufferAttribute(rebased, 4))
    } else if (source.hasAttribute(name)) {
      geometry.setAttribute(name, source.getAttribute(name))
    } else {
      // One this bake had none of: filled, as FILLERS says.
      const filler = FILLERS[name]!
      const filled = new Float32Array(vat.vertexCount * filler.length)
      for (let v = 0; v < vat.vertexCount; v++) filled.set(filler, v * filler.length)
      geometry.setAttribute(name, new BufferAttribute(filled, filler.length))
    }
  }
  // An index in vertex order where the bake had none, which moves nothing: a
  // batch holds indexed geometries or none.
  geometry.setIndex(Array.from(indexOf(source)))
  return boundedBy(geometry, vat.bounds)
}

/** The atlas's fields past its texture: the clips, the bounds, the geometry, and the record of where each character sits. */
function atlasFields(vats: readonly VAT[], characters: readonly VATAtlasCharacter[], totalFrames: number) {
  const bounds = new Box3()
  for (const vat of vats) bounds.union(vat.bounds)
  // A frame's box is every character's that has that frame: a shorter
  // character's padding rows show nothing of it.
  const frameBounds = new Float32Array(totalFrames * 6)
  const box = new Box3()
  for (let f = 0; f < totalFrames; f++) {
    box.makeEmpty()
    for (const vat of vats) if (f < vat.totalFrames) addFrame(vat.frameBounds, f, box)
    box.min.toArray(frameBounds, f * 6)
    box.max.toArray(frameBounds, f * 6 + 3)
  }

  const geometry = boundedBy(endToEnd(characters, vats), bounds)

  return {
    geometry,
    materials: vats.flatMap((vat) => vat.materials),
    clips: vats.flatMap((vat) => vat.clips),
    bounds,
    frameBounds,
    vertexCount: vats.reduce((n, vat) => n + vat.vertexCount, 0),
    totalFrames,
    characters: characters.map(({ geometry, clips, ...range }) => range),
  }
}

/**
 * The atlas's own `geometry`: every character's end to end, as the batch lays
 * them out, with each one's groups kept and pointed at its materials among the
 * atlas's. What the batch holds, as one geometry.
 */
function endToEnd(characters: readonly VATAtlasCharacter[], vats: readonly VAT[]): BufferGeometry {
  const geometry = new BufferGeometry()
  const first = characters[0]!.geometry
  for (const name of Object.keys(first.attributes)) {
    const { itemSize, normalized, array } = first.getAttribute(name) as BufferAttribute
    const total = characters.reduce((n, c) => n + c.vertexCount, 0)
    const out = new (array.constructor as Float32ArrayConstructor)(total * itemSize)
    for (const c of characters) {
      const attribute = c.geometry.getAttribute(name)
      for (let v = 0; v < c.vertexCount; v++) {
        for (let i = 0; i < itemSize; i++) out[(c.vertexStart + v) * itemSize + i] = attribute.getComponent(v, i)
      }
    }
    geometry.setAttribute(name, new BufferAttribute(out, itemSize, normalized))
  }

  const indices: number[] = []
  let materialStart = 0
  characters.forEach((c, k) => {
    const indexStart = indices.length
    const index = c.geometry.getIndex()!
    for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + c.vertexStart)
    const groups = vats[k]!.geometry.groups
    if (groups.length === 0) geometry.addGroup(indexStart, index.count, materialStart)
    for (const group of groups) geometry.addGroup(indexStart + group.start, group.count, group.materialIndex! + materialStart)
    materialStart += vats[k]!.materials.length
  })
  geometry.setIndex(indices)
  return geometry
}
