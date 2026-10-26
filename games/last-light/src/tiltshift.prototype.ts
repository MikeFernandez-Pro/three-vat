// PROTOTYPE, throwaway (`?tilt`): a tilt-shift, the miniature look, as a
// diorama. Three things together, since the blur alone read as a plain depth
// of field (the first round, 2026-10-25):
//
// - The camera high over her and far back, looking down steeply, so the whole
//   of the place around her is in the frame, as a model on a table.
// - The depth of field's blur (post.ts) taken over: how far out of focus a
//   pixel is comes from how far it lies off a band across the screen, not
//   from its depth. Sharp inside the band, softening over `falloff` either
//   side of it, fully soft past that; the band can lean by `angle`. The blur
//   is the tilt's own size, in pixels, over twice the taps.
// - A toy's grade over the finished frame: brighter, more contrast, richer.
//
// With it on, the deep output is drawn whether or not the depth of field is.
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import { Vector2, type Node } from 'three/webgpu'
import { abs, max, mix, pow, saturation, screenSize, screenUV, smoothstep, uniform, vec2 } from 'three/tsl'

export interface TiltLook {
  enabled: boolean
  /** Where the band's middle is, a share of the screen's height from the top. */
  centre: number
  /** The band's half-width, a share of the screen's height. */
  width: number
  /** How far past the band the blur takes to be full, a share of the screen's height. */
  falloff: number
  /** How far the band leans, degrees. */
  angle: number
  /** How big the blur gets, px. */
  blur: number
  /** The grade: the frame's brightness ×, its contrast around a mid grey, 1 as drawn, and its saturation, 1 as drawn. */
  exposure: number
  contrast: number
  saturation: number
  /** The camera: how high over her feet, m, how far back, m, and its field of view, degrees. */
  up: number
  back: number
  fov: number
}

// As the panel was set on 2026-10-25, on theme 21.
export const defaultTilt = (): TiltLook => ({
  enabled: true,
  centre: 0.44,
  width: 0.17,
  falloff: 0.25,
  angle: 0,
  blur: 4.5,
  exposure: 0.65,
  contrast: 1.05,
  saturation: 0.9,
  up: 9,
  back: 9.9,
  fov: 35,
})

/** The blur's taps under the tilt: twice the depth of field's, for its wider blur. */
export const TILT_TAPS = 32

/** Where the diorama's camera stands and looks, m from her feet, as a captured camera has it. */
export interface TiltCamera {
  camera: [number, number, number]
  target: [number, number, number]
  lag: number
  fov: number
}

export function createTiltShift() {
  const look = defaultTilt()
  const on = uniform(1)
  const centre = uniform(0.5)
  const width = uniform(0.05)
  const falloff = uniform(0.25)
  const normal = uniform(new Vector2(0, 1))
  const blur = uniform(14)
  const exposure = uniform(1)
  const contrast = uniform(1)
  const richness = uniform(1)
  // The distance off the band's line, in shares of the screen's height: across it the screen's x counts by its aspect.
  const aspect = screenSize.x.div(screenSize.y)
  const offset = screenUV.sub(vec2(0.5, centre)).mul(vec2(aspect, 1))
  const off = abs(offset.dot(normal))
  const coc = smoothstep(width, width.add(falloff), off) as unknown as Node<'float'>
  const set = () => {
    on.value = look.enabled ? 1 : 0
    centre.value = look.centre
    width.value = look.width
    falloff.value = Math.max(0.01, look.falloff)
    const a = (look.angle * Math.PI) / 180
    normal.value.set(-Math.sin(a), Math.cos(a))
    blur.value = look.blur
    exposure.value = look.exposure
    contrast.value = look.contrast
    richness.value = look.saturation
  }
  set()
  return {
    look,
    set,
    /** 1 while the tilt is on, else 0. */
    on: on as unknown as Node<'float'>,
    /** How out of focus the pixel is, 0 to 1. */
    coc,
    /** The blur's half-size, px, as the depth of field's `bokeh * 2`. */
    blur: blur as unknown as Node<'float'>,
    /** The toy's grade over `rgb`, linear: as drawn while the tilt is off. */
    grade(rgb: Node<'vec3'>): Node<'vec3'> {
      const lit = rgb.mul(exposure)
      // The contrast as a power round the linear mid grey, so the blacks stay black.
      const pivot = 0.18
      const contrasted = pow(max(lit, 0).div(pivot), contrast).mul(pivot)
      return mix(rgb, saturation(contrasted, richness), on) as unknown as Node<'vec3'>
    },
    /** The diorama's camera, the follow's lag as the goose game's own. */
    camera(lag: number): TiltCamera {
      return { camera: [0, look.up, look.back], target: [0, 0.3, 0], lag, fov: look.fov }
    },
  }
}

export type TiltShift = ReturnType<typeof createTiltShift>

/** The tilt-shift's own panel, at the bottom right: `changed` for the look, `placed` for the camera. */
export function mountTiltControls(tilt: TiltShift, changed: () => void, placed: () => void): void {
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:1000'
  document.body.append(container)
  const gui = new GUI({ title: 'tilt-shift (prototype)', container, width: 260 } as ConstructorParameters<typeof GUI>[0])
  const { look } = tilt
  const change = () => {
    tilt.set()
    changed()
  }
  gui.add(look, 'enabled').name('on').onChange(() => {
    change()
    placed()
  })
  const band = gui.addFolder('blur band')
  band.add(look, 'centre', 0, 1, 0.01).name('band at (from top)').onChange(change)
  band.add(look, 'width', 0, 0.5, 0.005).name('band half-width').onChange(change)
  band.add(look, 'falloff', 0.01, 1, 0.01).name('softens over').onChange(change)
  band.add(look, 'angle', -45, 45, 1).name('lean °').onChange(change)
  band.add(look, 'blur', 0, 40, 0.5).name('blur px').onChange(change)
  const grade = gui.addFolder('toy grade')
  grade.add(look, 'exposure', 0.5, 4, 0.05).name('brightness ×').onChange(change)
  grade.add(look, 'contrast', 0.5, 2, 0.01).onChange(change)
  grade.add(look, 'saturation', 0, 3, 0.05).onChange(change)
  const camera = gui.addFolder('camera')
  camera.add(look, 'up', 1, 30, 0.1).name('height m').onChange(placed)
  camera.add(look, 'back', 0, 30, 0.1).name('back m').onChange(placed)
  camera.add(look, 'fov', 10, 80, 1).name('fov °').onChange(placed)
}
