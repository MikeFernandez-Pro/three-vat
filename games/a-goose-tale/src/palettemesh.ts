// A palette for a model of flat colours: each of its materials one texel of a
// strip, and its meshes merged into one that reads its colour off the strip,
// so a model of twenty colours draws once and not twenty times. A colour, and
// how bright it glows, is laid on its texel by the material's name, so a panel
// edits it as it edited the material, and every merge drawn in it follows. The
// strip is laid on toon materials the page makes, a shell (shell.ts) or plain,
// so one palette may colour pieces drawn in toon materials of their own.
import { BufferGeometry, Color, DataTexture, DataUtils, Float32BufferAttribute, HalfFloatType, Matrix4, Mesh, MeshToonNodeMaterial, NearestFilter, Object3D, RGBAFormat, type Material } from 'three/webgpu'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export interface Palette {
  /** The material every merge is drawn in: the first it was laid on. */
  readonly material: MeshToonNodeMaterial
  /** Lay `colour` on material `name`'s texel, and how bright it glows in it, 0 not at all. */
  set(name: string, colour: number, glow?: number): void
  /**
   * `meshes` under `root`, each in one of the palette's materials, merged into one mesh in `root`'s own space and put
   * in their place on it, drawn in `material`, the palette's own unless given: one that reads the palette itself.
   */
  merge(root: Object3D, meshes: readonly Mesh[], material?: Material): Mesh
}

/** A strip of one texel each, in half floats: a glow may run past 1, and a full float texture cannot be sampled everywhere WebGPU runs. */
function strip(size: number): DataTexture {
  const texture = new DataTexture(new Uint16Array(size * 4), size, 1, RGBAFormat, HalfFloatType)
  texture.magFilter = texture.minFilter = NearestFilter
  texture.generateMipmaps = false
  return texture
}

/** A palette of a texel for each of `names`, laid on each of `materials`: their colour and glow read off it. */
export function createPalette(names: readonly string[], ...materials: [MeshToonNodeMaterial, ...MeshToonNodeMaterial[]]): Palette {
  const texelOf = new Map(names.map((name, i) => [name, i]))
  const colours = strip(names.length)
  const glows = strip(names.length)
  for (const toon of materials) {
    toon.map = colours
    toon.emissive.setHex(0xffffff)
    toon.emissiveMap = glows
  }
  const [material] = materials
  const colour = new Color()
  const lay = (texture: DataTexture, i: number, r: number, g: number, b: number) => {
    const data = texture.image.data as Uint16Array
    data.set([r, g, b, 1].map(DataUtils.toHalfFloat), i * 4)
    texture.needsUpdate = true
  }
  return {
    material,
    set(name, hex, glow = 0) {
      const i = texelOf.get(name)
      if (i === undefined) return
      colour.setHex(hex)
      lay(colours, i, colour.r, colour.g, colour.b)
      lay(glows, i, colour.r * glow, colour.g * glow, colour.b * glow)
    },
    merge(root, meshes, drawnIn = material) {
      root.updateMatrixWorld(true)
      const into = new Matrix4().copy(root.matrixWorld).invert()
      const pieces = meshes.map((mesh) => {
        const name = (mesh.material as { name: string }).name
        const i = texelOf.get(name)
        if (i === undefined) throw new Error(`palette: no texel for the material ${name}`)
        // Only the corners its triangles use: a mesh split by its index keeps every corner of the whole.
        const source = mesh.geometry
        const position = source.getAttribute('position')
        const normal = source.getAttribute('normal')
        const corners = source.index ? Array.from(source.index.array) : [...Array(position.count).keys()]
        const kept = new Map<number, number>()
        const index = corners.map((c) => kept.get(c) ?? kept.set(c, kept.size).get(c)!)
        const positions = new Float32Array(kept.size * 3)
        const normals = new Float32Array(kept.size * 3)
        for (const [c, k] of kept) {
          positions.set([position.getX(c), position.getY(c), position.getZ(c)], k * 3)
          normals.set([normal.getX(c), normal.getY(c), normal.getZ(c)], k * 3)
        }
        const piece = new BufferGeometry()
        piece.setAttribute('position', new Float32BufferAttribute(positions, 3))
        piece.setAttribute('normal', new Float32BufferAttribute(normals, 3))
        piece.setAttribute('uv', new Float32BufferAttribute(new Float32Array(kept.size * 2).map((_, k) => (k % 2 === 0 ? (i + 0.5) / names.length : 0.5)), 2))
        piece.setIndex(index)
        return piece.applyMatrix4(new Matrix4().multiplyMatrices(into, mesh.matrixWorld))
      })
      for (const mesh of meshes) mesh.removeFromParent()
      const merged = new Mesh(mergeGeometries(pieces), drawnIn)
      merged.castShadow = merged.receiveShadow = true
      root.add(merged)
      return merged
    },
  }
}
