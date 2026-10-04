// The ground: one flat plane under the hand-painted dirt that tools/dirt.mjs
// writes. A tiled texture repeats where the eye can catch it, so the dirt is
// read twice, at two scales and turned against each other, and a third read at
// a much larger scale picks which of the two shows, in patches with the
// painting's own hard edges.
import { Mesh, MeshStandardNodeMaterial, PlaneGeometry, RepeatWrapping, SRGBColorSpace, TextureLoader } from 'three/webgpu'
import { mix, positionWorld, smoothstep, texture, vec2 } from 'three/tsl'

/** How wide one tile of the dirt is on the ground, in metres. */
const TILE = 6
/** The second read: this much larger, and turned this far, in radians. */
const SECOND_SCALE = 1.7
const SECOND_TURN = 0.9
/** The read that picks between them: this much larger than a tile. */
const PATCH_SCALE = 7
/** How far the plane runs from the centre: past the largest arena, into the fog. */
const EXTENT = 60

export async function dirt(): Promise<Mesh> {
  const map = await new TextureLoader().loadAsync('./textures/dirt.png')
  map.wrapS = map.wrapT = RepeatWrapping
  map.colorSpace = SRGBColorSpace
  map.anisotropy = 8

  const at = positionWorld.xz
  const c = Math.cos(SECOND_TURN)
  const s = Math.sin(SECOND_TURN)
  const turned = vec2(at.x.mul(c).sub(at.y.mul(s)), at.x.mul(s).add(at.y.mul(c)))
  const first = texture(map, at.div(TILE))
  const second = texture(map, turned.div(TILE * SECOND_SCALE))
  // The dirt's own tones, read huge, cut at the middle of their range: the
  // texture is sRGB, so its red reads linear here, about 0.035 to 0.11.
  const patch = smoothstep(0.06, 0.07, texture(map, at.div(TILE * PATCH_SCALE)).r)

  const material = new MeshStandardNodeMaterial({ roughness: 1 })
  material.colorNode = mix(first, second, patch)
  const mesh = new Mesh(new PlaneGeometry(EXTENT * 2, EXTENT * 2), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.receiveShadow = true
  return mesh
}
