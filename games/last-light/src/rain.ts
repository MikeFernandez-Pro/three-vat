// The rain's streaks (#185), ported from Bruno Simon's folio-2025
// (https://github.com/brunosimon/folio-2025, at 41046b5:
// sources/Game/World/RainLines.js), under its MIT licence:
//
// MIT License
//
// Copyright (c) 2025 Bruno Simon
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// Thousands of thin streaks, one mesh, each a quad the vertex shader stands up
// and drops: every streak has its place in a square round the child, kept by
// repeating the square so it always surrounds him, and falls from high over
// the ground to the ground, over and over, each at its own point in the fall.
// As the rain comes in more of them show, longer and faster; dry, none does.
// What changes from folio-2025: its camera never turns, so a streak there is a
// ribbon at a fixed slant across the ground; here the orbit turns all round,
// so each streak turns to face the camera. Its ground is flat; here a streak
// falls to the ground's own height, the hill's or the ravine's, read off a
// grid of it. And a streak's place is wrapped with `fract`, which wraps the
// same on both backends where a remainder of a negative place does not. And
// a streak fades out near the camera, which folio-2025's never comes near.
import {
  BufferGeometry,
  DataTexture,
  DataUtils,
  DoubleSide,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  RedFormat,
  Uint16BufferAttribute,
  Vector2,
} from 'three/webgpu'
import { Fn, attribute, cameraPosition, clamp, fract, int, positionWorld, smoothstep, step, texture, uniform, vec2, vec3 } from 'three/tsl'
import type { HeightGrid } from './heights'
import { leaveUnshaded } from './post'
import { random } from './swarm'

/** How many streaks: folio-2025's two thousand, twice over, for a square as wide as the orbit needs. */
const COUNT = 2 ** 12
/** The square round the child they fall in, m a side; how high over the ground they start, m; and how thick a streak is, m. */
const SIZE = 30
const ELEVATION = 14
const THICKNESS = 0.012
/** How far a streak leans per metre over the ground, and which way along the ground the wind leans it. */
const INCLINE = 0.15
const LEAN = new Vector2(0.6, -0.8)
/** A streak's length, m, and how many times a second a streak falls, in a light rain and in the heaviest. */
const LENGTH = { light: 1, full: 2.2 }
const SPEED = { light: 0.35, full: 0.6 }
const COLOR = 0xb9c4e6
const OPACITY = 0.32
/** How near the camera a streak fades out, m: from wholly gone to wholly there. Close up a streak is a bar across the view. */
const NEAR = { gone: 2, there: 7 }
const SEED = 11

/** The rain's streaks: one mesh, moved on by the frame. */
export interface RainStreaks {
  readonly object: Mesh
  /** The rain `dt` s on, `amount` hard, 0 to 1, falling round the child at (x, z). */
  update(dt: number, amount: number, x: number, z: number): void
}

/** The rain's streaks, falling to the ground `ground` has. */
export function createRain(ground: HeightGrid): RainStreaks {
  // Each streak's four corners share its place on the square, 0 to 1, and its draw; each corner its side and end.
  const places = new Float32Array(COUNT * 4 * 3)
  const corners = new Float32Array(COUNT * 4 * 2)
  const draws = new Float32Array(COUNT * 4)
  const index = new Uint16Array(COUNT * 6)
  const next = random(SEED)
  for (let k = 0; k < COUNT; k++) {
    const x = next()
    const z = next()
    const draw = next()
    for (let c = 0; c < 4; c++) {
      const v = k * 4 + c
      places.set([x, 0, z], v * 3)
      // Corners 0 and 1 on one side, 0 and 3 at the top.
      corners.set([c === 0 || c === 1 ? 1 : 0, c === 0 || c === 3 ? 1 : 0], v * 2)
      draws[v] = draw
    }
    index.set([k * 4, k * 4 + 3, k * 4 + 2, k * 4 + 2, k * 4 + 1, k * 4], k * 6)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(places, 3))
  geometry.setAttribute('corner', new Float32BufferAttribute(corners, 2))
  geometry.setAttribute('draw', new Float32BufferAttribute(draws, 1))
  geometry.setIndex(new Uint16BufferAttribute(index, 1))

  // The ground's height, a texel a point of the grid, smoothed between them.
  const halves = new Uint16Array(ground.heights.length)
  for (let k = 0; k < halves.length; k++) halves[k] = DataUtils.toHalfFloat(ground.heights[k]!)
  const heights = new DataTexture(halves, ground.nx, ground.nz, RedFormat, HalfFloatType)
  heights.magFilter = heights.minFilter = LinearFilter
  heights.needsUpdate = true

  const centre = uniform(new Vector2())
  const length = uniform(LENGTH.light)
  const fallen = uniform(0)
  const shown = uniform(0)

  const material = new MeshBasicNodeMaterial({ color: COLOR, transparent: true, opacity: OPACITY, depthWrite: false, side: DoubleSide })
  material.positionNode = Fn(() => {
    const place = attribute<'vec3'>('position')
    const corner = attribute<'vec2'>('corner')
    const draw = attribute<'float'>('draw')
    // The copy of its place, the square repeating every SIZE, nearest the centre.
    const x = centre.x.add(fract(place.x.sub(centre.x.div(SIZE)).add(0.5)).sub(0.5).mul(SIZE))
    const z = centre.y.add(fract(place.z.sub(centre.y.div(SIZE)).add(0.5)).sub(0.5).mul(SIZE))
    const u = x.sub(ground.minX).div(ground.cell).add(0.5).div(ground.nx)
    const v = z.sub(ground.minZ).div(ground.cell).add(0.5).div(ground.nz)
    const floor = texture(heights, vec2(u, v)).level(int(0)).r
    // Falling from the top to the ground, its own way through the fall, its top end the length over its bottom.
    const fall = fract(fallen.add(draw))
    const top = floor.add(ELEVATION)
    const end = top.add(length).sub(length.mul(corner.y.oneMinus())).sub(fall.mul(length.add(ELEVATION)))
    // Hidden, far over the ground, unless the rain is hard enough for it.
    const y = clamp(end, floor, top).add(step(shown, fract(draw.mul(99))).mul(999))
    // Leant by the wind, the further over the ground the more; and as wide as it is thick, across the way to the camera.
    const leant = vec2(x, z).add(vec2(LEAN.x, LEAN.y).mul(y.sub(floor).mul(INCLINE)))
    const toCamera = cameraPosition.xz.sub(leant).normalize()
    const across = vec2(toCamera.y.negate(), toCamera.x).mul(corner.x.sub(0.5).mul(THICKNESS))
    return vec3(leant.x.add(across.x), y, leant.y.add(across.y))
  })()
  material.opacityNode = smoothstep(NEAR.gone, NEAR.there, positionWorld.distance(cameraPosition)).mul(OPACITY)
  leaveUnshaded(material)

  const object = new Mesh(geometry, material)
  object.frustumCulled = false
  object.castShadow = object.receiveShadow = false
  object.visible = false
  return {
    object,
    update(dt, amount, x, z) {
      // As many streaks as the square of how hard it rains, as folio-2025's: a light rain is a few.
      shown.value = amount * amount
      object.visible = shown.value > 1e-5
      if (!object.visible) return
      centre.value.set(x, z)
      length.value = LENGTH.light + (LENGTH.full - LENGTH.light) * amount
      fallen.value += dt * (SPEED.light + (SPEED.full - SPEED.light) * amount)
    },
  }
}
