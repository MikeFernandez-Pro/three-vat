// The lightning's bolts (#185), ported from Bruno Simon's folio-2025
// (https://github.com/brunosimon/folio-2025, at 41046b5:
// sources/Game/World/Lightnings.js and sources/Game/Geometries/LineGeometry.js),
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
// A strike, as folio-2025 draws one: first sparks of the charged air rising
// out of the ground where it will land; then the bolt, a jagged ribbon from
// the sky down to the ground, turned to face the camera, thinning from the
// ground up and spreading as it fades; and a burst of sparks thrown up round
// where it landed, falling as they die. Orange where it lands, blue up the
// bolt and out at the burst's edge, bright enough to bloom.
//
// What changes from folio-2025: its strikes fall at random over the map, each
// building its materials as it comes and timed by tweens; here the strikes
// are the play's two, scripted (weather.ts). Each has its bolt and sparks built
// once, drawn from the start and shown only from its time, so nothing compiles
// at the moment of the strike; and they are timed off the play's own clock,
// so the play started over strikes again and a paused play holds them. The
// sparks before a strike rise for the time the script gives before it is due.
// The bolt comes down beside the struck tree, on the side the child is, not
// inside its trunk, and stands on the ground's height; or, given no one to
// come down toward, on the very spot, at the height given it there (the goose
// game's log, struck on its roots). The line's sides are a
// corner's own attribute, where folio-2025 works them out from the vertex's
// index with a remainder that a negative number breaks on WebGPU; and its
// last point takes the direction of the one before, where folio-2025's has none.
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  SpriteNodeMaterial,
  Spherical,
  Uint16BufferAttribute,
  Vector3,
  type Node,
} from 'three/webgpu'
import {
  Fn,
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cross,
  float,
  instancedBufferAttribute,
  luminance,
  min,
  mix,
  modelWorldMatrix,
  positionGeometry,
  positionWorld,
  step,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'
import { leaveGlowing } from './post'
import { random } from './swarm'
import type { Strike } from './weather'
import type { Point } from './woods'

/** The strike's colours: where it lands, and up the bolt and out at the burst's edge; and how bright, over each colour's own lightness. */
const COLOURS = { ground: 0xff4c00, sky: 0x5180ff }
const INTENSITY = 3
/** The sparks of the charged air: how many, over how long before the strike they rise, s, how big, how high they rise, m, and how far round they start. */
const RISING = { count: 32, seconds: 3, scale: 0.07, rise: 1.5, round: 3 }
/** The bolt: its points, how high it goes, how far each point strays, m; how long it shows, s; how thick, m; and as it fades, how fast it spreads, `ease`, and how far, `drift`, a share of where each point strayed. */
const BOLT = { points: 15, height: 18, stray: 1, seconds: 1.5, thickness: 0.12, ease: 5, drift: 1 }
/** The burst: how many sparks, how long they live, s, how big, how far they fly, m, how fast they slow, and how far they fall as they die, m. */
const BURST = { count: 128, seconds: 3, scale: 0.1, reach: 3, ease: 8, fall: 1 }
/** How far off the struck tree's trunk the bolt comes down, m. */
const BESIDE = 0.7
/** A time no strike comes at, s. */
const NEVER = 1e6
const SEED = 23

/** The strikes' bolts and sparks: one group, moved on by the frame. */
export interface Lightning {
  readonly object: Group
  /**
   * The strikes at `now`, s of the play: each where the play has it, at the
   * height `groundAt` has for strike `k` there, on the side of its tree toward
   * `near`, the child, until it lands; on the spot with no one near.
   */
  update(now: number, strikes: readonly Strike[], near: Point | null, groundAt: (x: number, z: number, k: number) => number): void
}

type Float = Node<'float'>

/** A colour as a node. */
const rgb = (hex: number) => {
  const c = new Color(hex)
  return vec3(c.r, c.g, c.b)
}

/** The bolts of `count` strikes; with `rising` false, no sparks rise before them, each struck the moment it is called. */
export function createLightning(count: number, { rising: rises = true }: { rising?: boolean } = {}): Lightning {
  const next = random(SEED)
  const now = uniform(0)
  const ground = rgb(COLOURS.ground)
  const sky = rgb(COLOURS.sky)
  /** A colour as bright as INTENSITY over its own lightness: every hue as strong. */
  const bright = (c: Node<'vec3'>) => c.div(luminance(c)).mul(INTENSITY)
  /** From the ground's colour to the sky's over `reach` m from where the strike lands. */
  const graded = (reach: number) => bright(mix(ground, sky, positionWorld.sub(modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz).length().div(reach).min(1)))

  // The sparks rising before a strike: round where it lands, a little under the ground, each its own size.
  const rising = new Float32Array(RISING.count * 3)
  const risingScales = new Float32Array(RISING.count)
  for (let i = 0; i < RISING.count; i++) {
    const a = Math.PI * 2 * next()
    const r = next() * RISING.round
    rising.set([Math.sin(a) * r, -next(), Math.cos(a) * r], i * 3)
    risingScales[i] = next() * 0.75 + 0.25
  }
  const risingAt = instancedBufferAttribute(new InstancedBufferAttribute(rising, 3)) as unknown as Node<'vec3'>
  const risingScale = instancedBufferAttribute(new InstancedBufferAttribute(risingScales, 1)) as unknown as Node<'float'>

  // The burst: thrown up over a half sphere round where it lands.
  const burst = new Float32Array(BURST.count * 3)
  const burstScales = new Float32Array(BURST.count)
  const spherical = new Spherical()
  const p = new Vector3()
  for (let i = 0; i < BURST.count; i++) {
    p.setFromSpherical(spherical.set(next(), next() * 0.5 * Math.PI, next() * Math.PI * 2))
    burst.set([p.x, p.y, p.z], i * 3)
    burstScales[i] = next() * 0.75 + 0.25
  }
  const burstAt = instancedBufferAttribute(new InstancedBufferAttribute(burst, 3)) as unknown as Node<'vec3'>
  const burstScale = instancedBufferAttribute(new InstancedBufferAttribute(burstScales, 1)) as unknown as Node<'float'>

  const quad = new PlaneGeometry(1, 1)
  const bolts = Array.from({ length: count }, () => {
    const due = uniform(NEVER)
    const struck = uniform(NEVER)
    const group = new Group()
    group.rotation.y = next() * Math.PI * 2

    // Rising for the seconds before it is due, shrinking over the last half of them; gone once it lands.
    const sparks = new SpriteNodeMaterial({ transparent: true, depthWrite: false })
    const rose = now.sub(due.sub(RISING.seconds))
    const risen = risingAt.add(vec3(0, min(rose.div(RISING.seconds), 1).mul(RISING.rise), 0))
    sparks.positionNode = risen
    sparks.scaleNode = risingScale
      .mul(RISING.scale)
      .mul(rose.remapClamp(RISING.seconds * 0.5, RISING.seconds, 1, 0))
      .mul(risen.y.remapClamp(0, 0.2, 0, 1))
      .mul(step(0, rose))
      .mul(step(now, struck.sub(1e-4)))
    sparks.colorNode = bright(sky)
    leaveGlowing(sparks, bright(sky))
    const air = new Mesh(quad, sparks)
    air.count = RISING.count

    const boltMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
    boltMaterial.vertexNode = boltVertex(now, struck)
    boltMaterial.colorNode = graded(8)
    boltMaterial.fog = false
    leaveGlowing(boltMaterial, graded(8))
    const bolt = new Mesh(boltGeometry(next), boltMaterial)

    // Thrown out fast and slowing, shrinking as they live, falling as they die.
    const fly = new SpriteNodeMaterial({ transparent: true, depthWrite: false })
    const since = now.sub(struck)
    const flown = min(since.div(BURST.seconds * 0.75), 1).oneMinus().pow(BURST.ease).oneMinus().mul(BURST.reach)
    const fallen = min(since.div(BURST.seconds), 1).oneMinus().pow(2).oneMinus().mul(BURST.fall)
    fly.positionNode = burstAt.mul(flown).sub(vec3(0, fallen, 0))
    fly.scaleNode = burstScale.mul(BURST.scale).mul(since.div(BURST.seconds).oneMinus().max(0)).mul(step(0, since))
    fly.colorNode = graded(4)
    fly.fog = false
    leaveGlowing(fly, graded(4))
    const sparksOut = new Mesh(quad, fly)
    sparksOut.count = BURST.count

    for (const mesh of rises ? [air, bolt, sparksOut] : [bolt, sparksOut]) {
      mesh.frustumCulled = false
      mesh.castShadow = mesh.receiveShadow = false
      mesh.renderOrder = 2
      group.add(mesh)
    }
    return { group, due, struck, landed: false }
  })

  const object = new Group()
  for (const { group } of bolts) object.add(group)
  return {
    object,
    update(t, strikes, near, groundAt) {
      now.value = t
      strikes.forEach((strike, k) => {
        const bolt = bolts[k]
        if (bolt === undefined) return
        bolt.due.value = Number.isNaN(strike.due) ? NEVER : strike.due
        bolt.struck.value = Number.isNaN(strike.time) ? NEVER : strike.time
        // Beside its tree, on the child's side, until it lands; then where it landed.
        const landed = !Number.isNaN(strike.time)
        if (landed && bolt.landed) return
        bolt.landed = landed
        const dx = near ? near.x - strike.at.x : 0
        const dz = near ? near.z - strike.at.z : 0
        const d = Math.hypot(dx, dz) || 1
        const x = strike.at.x + (dx / d) * BESIDE
        const z = strike.at.z + (dz / d) * BESIDE
        bolt.group.position.set(x, groundAt(x, z, k), z)
      })
    },
  }
}

/** The bolt's line: from the ground up, each point strayed a little, a pair of corners a point, one each side. */
function boltGeometry(next: () => number): BufferGeometry {
  const points = Array.from({ length: BOLT.points }, (_, i) => new Vector3((next() - 0.5) * BOLT.stray, (i * BOLT.height) / (BOLT.points - 1), (next() - 0.5) * BOLT.stray))
  const n = points.length
  const positions = new Float32Array(n * 2 * 3)
  const directions = new Float32Array(n * 2 * 3)
  const ratios = new Float32Array(n * 2)
  const sides = new Float32Array(n * 2)
  const indices = new Uint16Array((n - 1) * 6)
  const way = new Vector3()
  for (let i = 0; i < n; i++) {
    // The way on to the next point; the last, the way it came.
    const from = points[Math.min(i, n - 2)]!
    way.copy(points[Math.min(i, n - 2) + 1]!).sub(from).normalize()
    for (const c of [0, 1]) {
      positions.set([points[i]!.x, points[i]!.y, points[i]!.z], (i * 2 + c) * 3)
      directions.set([way.x, way.y, way.z], (i * 2 + c) * 3)
      ratios[i * 2 + c] = i / (n - 1)
      sides[i * 2 + c] = c === 0 ? 0.5 : -0.5
    }
    if (i < n - 1) indices.set([i * 2 + 2, i * 2, i * 2 + 1, i * 2 + 1, i * 2 + 3, i * 2 + 2], i * 6)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('direction', new Float32BufferAttribute(directions, 3))
  geometry.setAttribute('ratio', new Float32BufferAttribute(ratios, 1))
  geometry.setAttribute('side', new Float32BufferAttribute(sides, 1))
  geometry.setIndex(new Uint16BufferAttribute(indices, 1))
  return geometry
}

/**
 * Where a corner of the bolt lands on screen at `now`, `struck` s: spread
 * out as it fades but for its foot, turned across the way to the camera, as
 * thick as it is that far up and that far through its showing; nothing before
 * the strike.
 */
function boltVertex(now: Float, struck: Float): Node<'vec4'> {
  return Fn(() => {
    const ratio = attribute<'float'>('ratio')
    const direction = attribute<'vec3'>('direction')
    const side = attribute<'float'>('side')
    const since = now.sub(struck)
    const shown = min(since.div(BOLT.seconds), 1)
    const foot = step(ratio, 0.01)
    const spread = shown.oneMinus().pow(BOLT.ease).oneMinus().mul(foot.oneMinus()).mul(BOLT.drift).add(1)
    const placed = vec3(positionGeometry.x.mul(spread), positionGeometry.y, positionGeometry.z.mul(spread))
    const world = modelWorldMatrix.mul(vec4(placed, 1)).xyz
    const toCamera = world.sub(cameraPosition).normalize()
    const along = modelWorldMatrix.mul(vec4(placed.add(direction), 1)).xyz.sub(world).normalize()
    const across = cross(along, toCamera).normalize()
    const thickness = float(BOLT.thickness).mul(ratio.mul(10).min(1)).mul(shown.oneMinus()).mul(step(0, since))
    return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world.add(across.mul(side.mul(thickness))), 1)))
  })() as unknown as Node<'vec4'>
}
