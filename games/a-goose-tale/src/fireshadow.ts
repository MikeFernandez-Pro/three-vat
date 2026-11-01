// The goose's and his goslings' shadow from the fire he stands in, cast away from its flame: what the fake lamps
// (fakelamps.ts) have no shadow map for. A projector stands on the fire's side of him and draws only them, white on
// black, into a small mask: one pass of a few skinned meshes, no rats, trees or walls, no lights, no shadows of its
// own. The floor's shader finds each of its fragments in the projector's view, reads the mask there, and takes that
// fire's light away where he covers it, the moon's left lighting the patch. So the shadow is his outline as posed,
// laid over every rise of the ground, and on the ground alone: he is not shadowed by his own fire.
//
// The projector stands lower than the flame, `lift` over his head: a fire high above him casts him as it would, short,
// a lump at his feet; lowered, it casts him long, the way a fire behind him reads. `atFlame` puts it at the flame.
// One fire at a time, the one whose light on him is strongest: walking from one to the next hands the shadow over.
import { MeshBasicNodeMaterial, PerspectiveCamera, RenderTarget, Scene, Vector3, type Color, type Material, type Mesh, type Object3D, type SkinnedMesh, type WebGPURenderer } from 'three/webgpu'
import { shown, type FakeLamp, type FakeLamps } from './fakelamps'

/** What the fire shadows folder edits. */
export interface FireShadowLook {
  enabled: boolean
  /** How dark, 0 none to 1 the fire's light all `color`. */
  strength: number
  /** What the fire's light is in it, as a filter: black none of it, a deep blue its light gone cold. */
  color: number
  /** How soft its edge, widening the further it falls from him; 0 hard. */
  softness: number
  /** How far over his head the projector stands, m: the lower, the longer he is cast. */
  lift: number
  /** The projector at the flame itself, true to the fire, `lift` aside. */
  atFlame: boolean
  /** How far round him it sees, m: his goslings further off cast nothing. */
  cover: number
}

/** The fire shadows to start, as set from the panel on 2026-10-29: the fire's light gone a cold violet, hard edged, the projector a metre over his head, his circle seen. */
export function defaultFireShadowLook(): FireShadowLook {
  return { enabled: true, strength: 0.86, color: 0xa094ff, softness: 0.02, lift: 1.05, atFlame: false, cover: 2 }
}

/** The mask's side, px. */
const SIZE = 512
/** The layer only him and his goslings are drawn on besides their own, the projector's. */
const LAYER = 7
/** The widest the projector sees, degrees, standing right over him. */
const MAX_FOV = 140

export interface FireShadow {
  /**
   * Lay the projector for this frame and draw the mask: `casters` the goose's and goslings' groups, none while he is
   * not drawn, `middle` his middle, `height` his height, `ground` the ground's height under him.
   */
  update(casters: readonly Object3D[], middle: Vector3, height: number, ground: number): void
}

/** The fire shadow on `lamps`, falling on `receivers`' materials, drawn by `renderer`; `look` read every frame. */
export function createFireShadow(renderer: WebGPURenderer, lamps: FakeLamps, look: FireShadowLook, receivers: readonly Mesh[]): FireShadow {
  const target = new RenderTarget(SIZE, SIZE, { depthBuffer: false })
  const white = new MeshBasicNodeMaterial({ color: 0xffffff, fog: false })
  const camera = new PerspectiveCamera(60, 1, 0.05, 50)
  camera.layers.set(LAYER)
  // The mask's own stage, white over everything on it: the casters' groups lent it as its children for the pass, each
  // left in the scene all the while, its parent unchanged; so the pass neither walks nor updates the whole scene.
  const stage = new Scene()
  stage.overrideMaterial = white
  stage.matrixWorldAutoUpdate = false
  const { shadow } = lamps
  shadow.mask = target.texture
  for (const receiver of receivers) shadow.receivers.add(receiver.material as Material)

  const flame = new Vector3()
  const clear = { color: undefined as Color | undefined, alpha: 1 }
  /** The fire whose light reaches `at` strongest, as the lamps' shader has it fall off; none lit there, none. */
  const strongest = (at: Vector3): FakeLamp | null => {
    let best: FakeLamp | null = null
    let most = 0
    for (const lamp of lamps.lamps) {
      if (!(lamp.intensity > 0) || !lamp.shadows || !shown(lamp)) continue
      const d = lamp.getWorldPosition(flame).distanceTo(at)
      if (lamp.distance > 0 && d >= lamp.distance) continue
      const cut = lamp.distance > 0 ? Math.max(0, 1 - (d / lamp.distance) ** 4) ** 2 : 1
      const light = (lamp.intensity * cut) / Math.max(d, 0.01) ** lamp.decay
      if (light > most) {
        most = light
        best = lamp
      }
    }
    return best
  }

  return {
    update(casters, middle, height, ground) {
      shadow.lamp = look.enabled && look.strength > 0 && casters.length > 0 ? strongest(middle) : null
      shadow.strength = look.strength
      shadow.colour.set(look.color)
      shadow.softness = look.softness
      if (!shadow.lamp) return
      shadow.lamp.getWorldPosition(flame)
      const at = shadow.at.copy(flame)
      if (!look.atFlame) at.y = ground + height + look.lift
      // Right over him it looks straight down, its up along the ground.
      const across = Math.hypot(at.x - middle.x, at.z - middle.z)
      camera.up.set(0, 1, 0)
      if (across < 0.01) camera.up.set(0, 0, 1)
      camera.position.copy(at)
      camera.lookAt(middle)
      const away = at.distanceTo(middle)
      camera.fov = Math.min(MAX_FOV, (2 * Math.atan(look.cover / Math.max(away, 0.01)) * 180) / Math.PI)
      camera.far = away + look.cover * 4 + 1
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld()
      shadow.view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      shadow.blocker = away

      // Only the skinned bodies on the projector's layer: his flame and anything else he carries cast nothing. Their
      // places as of this frame, the scene's own update not yet run.
      for (const group of casters) {
        group.traverse((o) => (o as SkinnedMesh).isSkinnedMesh && o.layers.enable(LAYER))
        group.updateMatrixWorld()
      }
      const before = renderer.getRenderTarget()
      // No outputs but its colour, whatever another pass left set: the loading's compileAsync sets the scene pass's on
      // each of its steps, and the white drawn under them wrote none of the mask's, failing to build (2026-10-30).
      const outputsWere = renderer.getMRT()
      renderer.setMRT(null)
      clear.color = renderer.getClearColor(clear.color ?? white.color.clone())
      clear.alpha = renderer.getClearAlpha()
      renderer.setClearColor(0x000000, 1)
      renderer.setRenderTarget(target)
      renderer.clear()
      stage.children = casters as Object3D[]
      renderer.render(stage, camera)
      stage.children = []
      renderer.setRenderTarget(before)
      renderer.setMRT(outputsWere)
      renderer.setClearColor(clear.color, clear.alpha)
    },
  }
}
