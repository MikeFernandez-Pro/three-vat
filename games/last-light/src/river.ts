// The river under the bridge (#185), rebuilt from the ideas of the water in
// Bruno Simon's folio-2025 (https://github.com/brunosimon/folio-2025, at
// 41046b5: sources/Game/World/WaterSurface.js and sources/Game/Water.js),
// under its MIT licence:
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
// folio-2025's water is a plane over its terrain, white where a detail is
// drawn: a line along the shore, ripples running in to it, and, while it
// rains, splashes; each read off how deep the terrain's texture says the water
// is. Here the river is a plain sheet over its sunk bed, the dark water lit as
// the rest of the scene is, and the details pale over it, read off a depth
// mask of the river's own: how far into the water each point is from the
// waterline, where the bed the height shapes sink (heights.ts) comes up
// through the surface. The ripples are bands running in to the shore, broken
// by noise a band at a time, thinning further out; a splash is a ring opening
// in a cell of a grid, a new draw of where and whether each time it opens, as
// many cells splashing as the rain is hard.
import { DataTexture, LinearFilter, Mesh, MeshToonNodeMaterial, RGBAFormat, Shape, ShapeGeometry, UnsignedByteType, Vector2, type Node, type Texture } from 'three/webgpu'
import { color, float, floor, fract, hash, max, mix, mx_noise_float, positionWorld, step, texture, uniform, vec2, vec3 } from 'three/tsl'
import { heightAt } from './heights'
import { within } from './walls'
import type { Woods } from './woods'

/** Where the river's water lies, m: under its banks, over its sunk bed. */
export const WATER = -0.45
/** The mask's grid, m a cell; and how far into the water it comes to full, m. */
const CELL = 0.1
const REACH = 1.5
const COLOURS = { water: 0x15212c, foam: 0x8d9fb6 }
/** How much the details glow of themselves, so they read faintly in the dark. */
const GLOW = 0.12
/** The line along the shore: how far into the mask it runs. */
const SHORE = 0.06
/**
 * The ripples: how many bands over the mask's depth, how fast they run in to
 * the shore, a band's width at the shore, how far out they reach, and the
 * noise that breaks them, how fine and how much of it.
 */
const RIPPLE = { bands: 5, speed: 0.35, width: 0.09, reach: 0.85, noise: 0.9, broken: 0.52 }
/** The splashes: a cell's size, m; how many times a second each opens; how wide it opens and how thick its ring starts, a share of the cell; and the share of the cells that splash in the heaviest rain. */
const SPLASH = { cell: 0.45, rate: 1.6, radius: 0.26, thickness: 0.035, most: 0.35 }

/**
 * How far into the river each point is, from the waterline: a grid over the
 * river, 0 where the ground stands over the water, rising to 1 REACH in.
 */
export class RiverMask {
  constructor(
    readonly minX: number,
    readonly minZ: number,
    readonly cell: number,
    readonly nx: number,
    readonly nz: number,
    /** The mask at each point, 0 to 255: along x, a row at a time. */
    readonly data: Uint8Array,
  ) {}

  /** The mask at the grid point nearest (x, z), 0 to 1; nothing off the grid. */
  at(x: number, z: number): number {
    const i = Math.round((x - this.minX) / this.cell)
    const j = Math.round((z - this.minZ) / this.cell)
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return 0
    return this.data[j * this.nx + i]! / 255
  }
}

/** The river's depth mask: each wet point's distance from the nearest dry one, chamfered over the grid. */
export function riverMask(map: Woods): RiverMask {
  const xs = map.river.map((p) => p.x)
  const zs = map.river.map((p) => p.z)
  const minX = Math.min(...xs) - CELL
  const minZ = Math.min(...zs) - CELL
  const nx = Math.ceil((Math.max(...xs) + CELL - minX) / CELL) + 1
  const nz = Math.ceil((Math.max(...zs) + CELL - minZ) / CELL) + 1
  const far = new Float32Array(nx * nz)
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = minX + i * CELL
      const z = minZ + j * CELL
      far[j * nx + i] = within(map.river, x, z) && heightAt(map.heights, x, z) < WATER ? Infinity : 0
    }
  }
  // Two passes, down then up, each taking the nearest of the neighbours already passed.
  const D = Math.SQRT2
  const pass = (j: number, i: number, steps: [number, number, number][]) => {
    const k = j * nx + i
    if (far[k] === 0) return
    for (const [dj, di, d] of steps) {
      const jj = j + dj
      const ii = i + di
      if (jj < 0 || ii < 0 || jj >= nz || ii >= nx) continue
      far[k] = Math.min(far[k]!, far[jj * nx + ii]! + d)
    }
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) pass(j, i, [[0, -1, 1], [-1, -1, D], [-1, 0, 1], [-1, 1, D]])
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) pass(j, i, [[0, 1, 1], [1, 1, D], [1, 0, 1], [1, -1, D]])
  const data = new Uint8Array(nx * nz)
  for (let k = 0; k < far.length; k++) data[k] = Math.round(Math.min(1, ((far[k] === Infinity ? 0 : far[k]!) * CELL) / REACH) * 255)
  return new RiverMask(minX, minZ, CELL, nx, nz, data)
}

/** The river's water: one mesh, its ripples and splashes moved on by the frame. */
export interface River {
  readonly object: Mesh
  /** The water at `time`, s, the rain `rain` hard, 0 to 1. */
  update(time: number, rain: number): void
}

/** The river drawn: its sheet of water, and the details over it. */
export function createRiver(map: Woods, gradient: Texture): River {
  const mask = riverMask(map)
  // The mask as a texture, each texel a grid point, smoothed between them.
  const texels = new Uint8Array(mask.nx * mask.nz * 4)
  for (let k = 0; k < mask.data.length; k++) texels[k * 4] = mask.data[k]!
  const maskTexture = new DataTexture(texels, mask.nx, mask.nz, RGBAFormat, UnsignedByteType)
  maskTexture.magFilter = maskTexture.minFilter = LinearFilter
  maskTexture.needsUpdate = true

  const time = uniform(0)
  const rain = uniform(0)
  const xz = positionWorld.xz
  const uv = vec2(xz.x.sub(mask.minX).div(mask.cell).add(0.5).div(mask.nx), xz.y.sub(mask.minZ).div(mask.cell).add(0.5).div(mask.nz))
  const depth = texture(maskTexture, uv).r
  const wet = step(0.001, depth)

  // The line along the shore.
  const shore = step(depth, SHORE).mul(wet)

  // The ripples: bands of the depth running in to the shore, each broken where its own noise falls short.
  const phase = depth.mul(RIPPLE.bands).add(time.mul(RIPPLE.speed))
  const band = fract(phase)
  const noise = mx_noise_float(vec3(xz.mul(RIPPLE.noise), floor(phase).mul(1.7))).mul(0.5).add(0.5)
  const ripple = step(band, depth.oneMinus().mul(RIPPLE.width)).mul(step(RIPPLE.broken, noise)).mul(step(depth, RIPPLE.reach)).mul(wet)

  // The splashes: in each cell a ring opening from a point of its own, a new point and a new draw each time it opens. Kept
  // to positive seeds: the hash reads its seed as a whole number.
  const cells = xz.div(SPLASH.cell)
  const cell = floor(cells).add(1000)
  const life = time.mul(SPLASH.rate)
  const seed = cell.x.add(cell.y.mul(2311))
  const offset = hash(seed.add(7))
  const opening = floor(life.add(offset))
  const drawn = seed.add(opening.mul(7919))
  const centre = vec2(hash(drawn.add(17)), hash(drawn.add(31))).mul(0.6).add(0.2)
  const open = fract(life.add(offset))
  const ring = step(fract(cells).sub(centre).length().sub(open.mul(SPLASH.radius)).abs(), open.oneMinus().mul(SPLASH.thickness))
  const splash = ring.mul(step(hash(drawn.add(53)), rain)).mul(wet)

  const detail = max(shore, max(ripple, splash))
  const foam = color(COLOURS.foam)
  const material = new MeshToonNodeMaterial({ gradientMap: gradient })
  material.colorNode = mix(color(COLOURS.water), foam, detail)
  // The toon material's type leaves out the emission node every node material reads.
  ;(material as unknown as { emissiveNode: Node }).emissiveNode = foam.mul(detail).mul(float(GLOW))

  const geometry = new ShapeGeometry(new Shape(map.river.map((p) => new Vector2(p.x, -p.z))))
  geometry.rotateX(-Math.PI / 2)
  const object = new Mesh(geometry, material)
  object.position.y = WATER
  object.receiveShadow = true
  return {
    object,
    update(t, amount) {
      time.value = t
      // As many cells splashing as the rain is hard, and the light rain's few far fewer: folio-2025's square.
      rain.value = amount * amount * SPLASH.most
    },
  }
}
