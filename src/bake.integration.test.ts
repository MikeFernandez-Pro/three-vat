import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import {
  AnimationClip,
  AnimationMixer,
  BatchedMesh,
  Matrix4,
  NumberKeyframeTrack,
  Texture,
  TextureLoader,
  Vector3,
} from 'three'
import type { BufferAttribute, BufferGeometry, Material, Mesh, Object3D, SkinnedMesh } from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { bakeVAT } from './bake.js'
import { createVATPlaybackTexture } from './instance-playback.js'
import {
  assetMissing,
  compileVATMaterial,
  deltaTexel,
  deltaTexels,
  expectDeltaClose,
  skinFromRig,
} from './test-utils.js'
import type { RigVAT } from './types.js'
import { createVATMesh, createVATUniforms, patchVATMaterial } from './webgl.js'

// Real-asset tests. Each is skipped rather than failed when its asset is
// absent, so the library suite never depends on a large binary being present:
// RobotExpressive ships with examples/, Soldier, Michelle and the two FBX files
// are fetched on demand (`node scripts/fetch-test-assets.mjs`; see
// docs/test-assets.md). The one place
// that leniency is wrong is CI, where a skip would look exactly like coverage —
// `assetMissing` throws there instead.
const ROBOT = 'examples/public/RobotExpressive.glb'
const SOLDIER = 'test-assets/Soldier.glb'

async function loadGLTF(path: string) {
  // GLTFLoader reads `self.URL` to turn an embedded texture into a blob URL.
  // Soldier embeds two; RobotExpressive embeds none, which is why this never
  // came up before. The image load that follows has no chance in Node and the
  // loader swallows it ("Couldn't load texture blob:…" on stderr), leaving the
  // materials map-less — all a bake needs, since it only carries them through.
  ;(globalThis as { self?: unknown }).self = globalThis

  const buf = readFileSync(path)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const loader = new GLTFLoader()
  return await new Promise<any>((res, rej) => loader.parse(ab, '', res, rej))
}

const ROBOT_CLIPS = ['Idle', 'Walking', 'Running', 'Dance', 'Wave']

// ADR-0008 regression guard: RobotExpressive is a rigid, node-animated
// hierarchy, which the pre-ADR single-mesh baker bakes as a frozen pose.
describe.skipIf(assetMissing(ROBOT))('RobotExpressive end-to-end', () => {
  it('bakes the real multi-part rigid hierarchy with non-zero deltas', async () => {
    const gltf = await loadGLTF(ROBOT)
    const clips = gltf.animations.filter((c: any) => ROBOT_CLIPS.includes(c.name))
    expect(clips).toHaveLength(5)

    const vat = bakeVAT(gltf.scene, clips, { encoding: 'delta', fps: 30 })

    console.log({
      vertexCount: vat.vertexCount,
      totalFrames: vat.totalFrames,
      materials: vat.materials.length,
      groups: vat.geometry.groups.length,
      mb: +((vat.vertexCount * vat.totalFrames * (8 + 2)) / 1048576).toFixed(1),
      clips: vat.clips.map((c) => ({ name: c.name, rows: c.frames, maxDelta: +c.maxDelta.toFixed(3) })),
    })

    expect(vat.vertexCount).toBe(7214)
    expect(vat.materials).toHaveLength(3)
    expect(vat.geometry.groups).toHaveLength(3)
    // The whole point: every clip must actually deform. Under the old baker
    // these were all ~0.
    for (const c of vat.clips) expect(c.maxDelta).toBeGreaterThan(0.1)
  })

  it('reconstructs the posed mesh as position + delta (decode identity)', async () => {
    const gltf = await loadGLTF(ROBOT)
    const clips = gltf.animations.filter((c: any) => c.name === 'Walking')
    const vat = bakeVAT(gltf.scene, clips, { encoding: 'delta', fps: 30 })

    const pos = vat.geometry.attributes.position!
    const data = deltaTexels(vat)
    // Every reconstructed vertex must land inside the baked bounds — that is
    // exactly what the shader computes.
    for (let row = 0; row < vat.totalFrames; row += 7) {
      for (let v = 0; v < vat.vertexCount; v += 311) {
        const o = (row * vat.vertexCount + v) * 4
        const x = pos.getX(v) + data[o]!
        const y = pos.getY(v) + data[o + 1]!
        const z = pos.getZ(v) + data[o + 2]!
        expect(vat.bounds.containsPoint({ x, y, z } as any)).toBe(true)
      }
    }
  })

  it('bakes under a phone’s 4096, two rows a frame, and every vertex where one row put it (ADR-0030)', async () => {
    // The Xiaomi Mi 9's ceiling, which refused this asset under the vertex
    // encoding before a frame could span rows (#77, ADR-0027).
    const gltf = await loadGLTF(ROBOT)
    const clips = gltf.animations.filter((c: any) => c.name === 'Walking')
    const spanned = bakeVAT(gltf.scene, clips, { encoding: 'delta', fps: 30, maxTextureSize: 4096 })
    const flat = bakeVAT(gltf.scene, clips, { encoding: 'delta', fps: 30 })

    expect(spanned.rowsPerFrame).toBe(2)
    expect(spanned.positionTexture.image.width).toBe(3607)
    expect(spanned.positionTexture.image.height).toBe(flat.totalFrames * 2)
    expect(flat.rowsPerFrame).toBe(1)
    // Every texel of every frame, compared raw: the two bakes differ only in
    // where a texel sits, so the stored bits are identical, not merely close.
    // Counted rather than asserted per texel, which is a quarter of a million
    // `expect`s at this size.
    const layers = [
      [spanned.positionTexture, flat.positionTexture, 4],
      [spanned.normalTexture!, flat.normalTexture!, 2],
    ] as const
    for (const [a, b, channels] of layers) {
      const [got, want] = [a.image.data as ArrayLike<number>, b.image.data as ArrayLike<number>]
      let differing = 0
      for (let row = 0; row < flat.totalFrames; row++) {
        for (let v = 0; v < flat.vertexCount; v++) {
          const [i, j] = [deltaTexel(spanned, row, v) * channels, deltaTexel(flat, row, v) * channels]
          for (let c = 0; c < channels; c++) if (got[i + c] !== want[j + c]) differing++
        }
      }
      expect(differing).toBe(0)
    }
  })
})

/** Every clip the asset carries — the fourteen ADR-0018 counted. */
const ROBOT_ALL_CLIPS = [
  'Dance',
  'Death',
  'Idle',
  'Jump',
  'No',
  'Punch',
  'Running',
  'Sitting',
  'Standing',
  'ThumbsUp',
  'Walking',
  'WalkJump',
  'Wave',
  'Yes',
]
/** The three meshes that carry the face's morph targets, and the target every clip tracks. */
const ROBOT_HEAD_PARTS = ['Head_2', 'Head_3', 'Head_4']

// The demo asset under the rig encoding. ADR-0018 records it as refused —
// "every one of its fourteen clips animates its head's morphs" — and the spec
// (#48) and this ticket (#54) asked for that refusal to be pinned. It is not
// what the asset does. Every clip does carry a morph track on each head part,
// but every one of those tracks is held flat at zero, the mesh's own rest
// value: a pose written down fourteen times, not animation. The glossary and
// #53 read "animates" strictly — an influence that is one number at every
// baked frame is folded into the rest pose — so RobotExpressive *takes* the
// rig encoding, and its rig bake lands where its vertex bake does. This block
// pins that, and pins the refusal on the asset the ADR believed it had.
describe.skipIf(assetMissing(ROBOT))('RobotExpressive under the rig encoding', () => {
  /** The head parts' morph tracks in `clip`, by head part name. */
  function headMorphTracks(clip: any): Map<string, any> {
    const tracks = new Map<string, any>()
    for (const track of clip.tracks) {
      const [node, property] = track.name.split('.')
      if (property === 'morphTargetInfluences' && ROBOT_HEAD_PARTS.includes(node)) tracks.set(node, track)
    }
    return tracks
  }

  it('carries a head morph track in every clip, every one of them flat at zero — the fact the fold rests on', async () => {
    const gltf = await loadGLTF(ROBOT)
    expect(gltf.animations.map((c: any) => c.name)).toEqual(ROBOT_ALL_CLIPS)

    for (const clip of gltf.animations) {
      const tracks = headMorphTracks(clip)
      expect([...tracks.keys()].sort()).toEqual(ROBOT_HEAD_PARTS)
      for (const track of tracks.values()) {
        expect(track.getValueSize()).toBe(3)
        expect(new Set(track.values)).toEqual(new Set([0]))
      }
    }
    for (const name of ROBOT_HEAD_PARTS) {
      const head = gltf.scene.getObjectByName(name) as any
      expect(Array.from(head.morphTargetInfluences)).toEqual([0, 0, 0])
    }
  })

  it('bakes with all fourteen clips — fifteen rigid parts and the two hands’ 43 shared bones, 58 slots', async () => {
    const gltf = await loadGLTF(ROBOT)
    expect(gltf.animations).toHaveLength(14)

    const vat = bakeVAT(gltf.scene, gltf.animations, { fps: 30, encoding: 'rig' })

    console.log({
      slotCount: vat.slotCount,
      totalFrames: vat.totalFrames,
      kb: +((vat.rigTexture.image.data as Float32Array).byteLength / 1024).toFixed(1),
      clips: vat.clips.map((c) => ({ name: c.name, rows: c.frames, maxDelta: +c.maxDelta.toFixed(3) })),
    })

    // Fifteen rigid parts at one slot each; four hand parts on two `Skeleton`
    // objects that list the same 43 bones through the same inverses, so the
    // rig contributes 43 slots and not 86 — the same sharing Soldier's visor
    // gets, on the asset that has the most to gain from it.
    expect(vat.slotCount).toBe(15 + 43)
    expect(vat.vertexCount).toBe(7214)
    expect(vat.materials).toHaveLength(3)
    expect(vat.clips.map((c) => c.name)).toEqual(ROBOT_ALL_CLIPS)
    // Every clip moves, as it did under the vertex encoding.
    for (const c of vat.clips) expect(c.maxDelta).toBeGreaterThan(0.1)

    // A zero fold leaves the head geometry exactly as authored: each head is
    // a rigid part, so it is one contiguous run of vertices on one slot at
    // weight one, and that run is its source positions verbatim. (A hand
    // vertex weighted wholly to one bone makes such a run too, so the runs
    // are not counted — each head is found by its own count and positions.)
    const runs = singleSlotRuns(vat)
    for (const name of ROBOT_HEAD_PARTS) {
      const source = (gltf.scene.getObjectByName(name) as any).geometry.attributes.position
      const run = runs.find((r) => r.count === source.count && sameVertices(vat.geometry, r.start, source))
      expect(run, `${name}'s ${source.count} vertices, verbatim, on one slot`).toBeDefined()
    }
  })

  it('composed and skinned on the CPU, lands where the vertex bake put the vertex, sampled across rows and parts', async () => {
    const gltf = await loadGLTF(ROBOT)
    const clips = gltf.animations.filter((c: any) => ROBOT_CLIPS.includes(c.name))

    // The spec's oracle for the rig encoding: the vertex encoding, which
    // already knows where every vertex ends up — through the mixer, the node
    // hierarchy and the hands' skinning alike.
    const delta = bakeVAT(gltf.scene, clips, { encoding: 'delta', fps: 30 })
    const rig = bakeVAT(gltf.scene, clips, { fps: 30, encoding: 'rig' })
    expect(rig.totalFrames).toBe(delta.totalFrames)

    // Every fifth row and a prime vertex stride, as the Soldier oracle samples.
    // The four decimals this always held the two encodings to are the floor;
    // what the position layer's half-float store costs rides on top of them,
    // as a fraction of the delta rather than a distance (#73).
    for (let row = 0; row < rig.totalFrames; row += 5) {
      for (let v = 0; v < rig.vertexCount; v += 97) {
        expectDeltaClose(delta, row, v, skinFromRig(rig, v, row).position, 0.5e-4)
      }
    }
  })

  it('is refused, naming the head parts and all fourteen clips, once the head’s morphs are made to animate', async () => {
    // The asset ADR-0018 described: the same fourteen clips, each now ramping
    // the head's "Angry" target from 0 to 1. One refusal names every head
    // part and every clip, and nothing is sampled first.
    const gltf = await loadGLTF(ROBOT)
    const animated = gltf.animations.map(
      (clip: any) =>
        new AnimationClip(
          clip.name,
          clip.duration,
          clip.tracks.map((track: any) =>
            [...headMorphTracks(clip).values()].includes(track)
              ? new NumberKeyframeTrack(track.name, [0, clip.duration], [0, 0, 0, 1, 0, 0])
              : track,
          ),
        ),
    )

    let message = ''
    try {
      bakeVAT(gltf.scene, animated, { fps: 30, encoding: 'rig' })
    } catch (e) {
      message = (e as Error).message
    }

    expect(message).toMatch(/rig encoding cannot bake/)
    for (const part of ROBOT_HEAD_PARTS) expect(message).toContain(`"${part}"`)
    for (const clip of ROBOT_ALL_CLIPS) expect(message).toContain(`"${clip}"`)
    expect(message).toContain('"Angry"')
    expect(message).toMatch(/vertex encoding/)
    // Once, not once per head part: the fourteen names appear a single time.
    expect(message.split('"Yes"')).toHaveLength(2)
  })
})

/**
 * The contiguous runs of merged vertices weighted wholly to one slot, in
 * merged order — every rigid part is one, read off the geometry rather than
 * the baker's part list.
 */
function singleSlotRuns(vat: RigVAT): { slot: number; start: number; count: number }[] {
  const index = vat.geometry.attributes.skinIndex!
  const weight = vat.geometry.attributes.skinWeight!
  const runs: { slot: number; start: number; count: number }[] = []
  for (let v = 0; v < vat.vertexCount; v++) {
    const rigid = weight.getX(v) === 1 && weight.getY(v) === 0 && weight.getZ(v) === 0 && weight.getW(v) === 0
    const slot = index.getX(v)
    const last = runs[runs.length - 1]
    if (!rigid) continue
    if (last && last.slot === slot && last.start + last.count === v) last.count++
    else runs.push({ slot, start: v, count: 1 })
  }
  return runs
}

/** Are the merged vertices from `start` on the source attribute's positions, exactly? */
function sameVertices(merged: BufferGeometry, start: number, source: BufferAttribute): boolean {
  const position = merged.attributes.position!
  for (let v = 0; v < source.count; v++) {
    if (
      position.getX(start + v) !== source.getX(v) ||
      position.getY(start + v) !== source.getY(v) ||
      position.getZ(start + v) !== source.getZ(v)
    ) {
      return false
    }
  }
  return true
}

// The headline claim, on a real skinned character: Soldier is a two-part
// Mixamo-style rig — 7 434 vertices over 49 bones, four clips — where every
// vertex moves through skinning alone. RobotExpressive proves the rigid half
// of ADR-0008; this proves the skinned half.
// Clip name → rows at 30 fps, read off the asset's durations rather than
// recomputed from the baker's rounding rule: restating that rule here would
// make the assertion agree with the baker by construction.
const SOLDIER_ROWS: Record<string, number> = { Idle: 59, Run: 21, TPose: 2, Walk: 31 }
const SOLDIER_CLIPS = Object.keys(SOLDIER_ROWS)
// TPose is not padding: the asset's rest pose *is* its T-pose, so that clip
// bakes as a genuine frozen pose. Keeping it makes maxDelta a two-sided
// diagnostic — the moving clips must be far from zero and the static one must
// be at zero, which a uniformly broken bake cannot satisfy.
const MOVING = ['Idle', 'Run', 'Walk']

describe.skipIf(assetMissing(SOLDIER))('Soldier end-to-end (skinned)', () => {
  it('bakes a real 49-bone skinned character', async () => {
    const gltf = await loadGLTF(SOLDIER)
    const clips = gltf.animations.filter((c: any) => SOLDIER_CLIPS.includes(c.name))
    expect(clips).toHaveLength(4)

    const vat = bakeVAT(gltf.scene, clips, { encoding: 'delta', fps: 30 })

    console.log({
      vertexCount: vat.vertexCount,
      totalFrames: vat.totalFrames,
      materials: vat.materials.length,
      groups: vat.geometry.groups.length,
      mb: +((vat.vertexCount * vat.totalFrames * (8 + 2)) / 1048576).toFixed(1),
      clips: vat.clips.map((c) => ({ name: c.name, rows: c.frames, maxDelta: +c.maxDelta.toFixed(3) })),
    })

    // Body (7 325) + visor (109), merged into one vertex set.
    expect(vat.vertexCount).toBe(7434)
    // Two materials, so two groups — one draw call each, no splitting.
    expect(vat.materials).toHaveLength(2)
    expect(vat.geometry.groups).toHaveLength(2)
    expect(vat.geometry.groups.map((g) => g.materialIndex)).toEqual([0, 1])

    // Clip table: every clip present, resampled to its own row count, stacked
    // contiguously in source order — which is what makes `startFrame` usable
    // as a texture row.
    expect(vat.clips.map((c) => c.name)).toEqual(SOLDIER_CLIPS)
    let expectedStart = 0
    for (const clip of clips) {
      const baked = vat.clips.find((c) => c.name === clip.name)!
      expect(baked.frames).toBe(SOLDIER_ROWS[clip.name])
      expect(baked.startFrame).toBe(expectedStart)
      expect(baked.duration).toBeCloseTo(clip.duration, 5)
      expectedStart += baked.frames
    }
    expect(vat.totalFrames).toBe(expectedStart)
    expect(vat.totalFrames).toBe(113)
  })

  it('deforms on every moving clip, and only on those', async () => {
    const gltf = await loadGLTF(SOLDIER)
    const clips = gltf.animations.filter((c: any) => SOLDIER_CLIPS.includes(c.name))
    const vat = bakeVAT(gltf.scene, clips, { encoding: 'delta', fps: 30 })

    // The character is ~1.8 m tall, so a walk/run/idle swings limbs by the
    // better part of a metre. Anything near zero here is the frozen-pose bug.
    for (const name of MOVING) {
      expect(vat.clips.find((c) => c.name === name)!.maxDelta).toBeGreaterThan(0.5)
    }
    expect(vat.clips.find((c) => c.name === 'TPose')!.maxDelta).toBeLessThan(0.01)
  })

  it('reconstructs what the mixer posed, vertex for vertex (decode identity)', async () => {
    const gltf = await loadGLTF(SOLDIER)
    const clip = gltf.animations.find((c: any) => c.name === 'Walk')
    const vat = bakeVAT(gltf.scene, [clip], { encoding: 'delta', fps: 30 })

    // 97 lands twice inside the 109-vertex visor, so the second part is
    // genuinely covered.
    const oracle = await loadGLTF(SOLDIER)
    expectMatchesMixer({ root: oracle.scene, clips: oracle.animations }, SOLDIER_PARTS, 97, vat, (row, v, expected) =>
      // Exactly what the shader computes: position + delta — to the four
      // decimals three's own skinning is reproduced to, plus what the
      // half-float store costs the delta itself (#73).
      expectDeltaClose(vat, row, v, expected, 0.5e-4),
    )
  })

  // The bake's own texels, pinned. Every other assertion here samples — every
  // third row, every 97th vertex, to a tolerance — which is exactly the shape a
  // rewrite of the skinning hot loop can pass while having moved a texel it
  // never looked at. A digest looks at all of them.
  //
  // It is a pin on *this* asset under *this* three, so it is allowed to move —
  // but only deliberately: a change to the baker's math, to three's sampling, or
  // to the asset re-pins it. A change that is meant to be pure optimisation —
  // the baker's per-frame posed skeletons, say — must not.
  it('bakes the same texels it always has (digest pin)', async () => {
    const gltf = await loadGLTF(SOLDIER)
    const clips = gltf.animations.filter((c: any) => SOLDIER_CLIPS.includes(c.name))
    const vat = bakeVAT(gltf.scene, clips, { encoding: 'delta', fps: 30 })

    expect(digest(vat.positionTexture.image.data as Uint16Array)).toBe(SOLDIER_DIGEST.position)
    expect(digest(vat.normalTexture!.image.data as Uint8Array)).toBe(SOLDIER_DIGEST.normal)
  })
})

/**
 * SHA-256 over a texture's raw texels — the whole buffer, byte for byte,
 * whatever numbers the layer stores them as (the position layer stores four
 * half-floats a texel since #73, the normal layer two unsigned bytes since
 * #29).
 */
function digest(data: Float32Array | Uint16Array | Uint8Array): string {
  return createHash('sha256')
    .update(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
    .digest('hex')
}

/**
 * Soldier's baked texels at 30 fps, all four clips, under each encoding. See
 * the digest tests. Both vertex-encoding pins have been moved once, each time
 * by a narrowing that changed what a texel *is* rather than what the baker
 * computes — the only kind of move this pin allows. `normal` by #29, from four
 * floats a texel to two octahedral bytes; `position` by #73, from four floats
 * to four half-floats, halving the buffer these bytes are taken from.
 */
const SOLDIER_DIGEST = {
  position: 'c439e83d7cea854afb42cd3878bd0d90935ebcea928cfe463d5c62b61d41c8b2',
  normal: 'dffa9b555b55922955ba6f9aa7a10681c794ef377d2eb8c07735937da5df5477',
  rig: '2e1738e738e18bf759c729a25533051edfb8479e4ab90659a68b980c4c9a3c76',
}

/**
 * Where the visor's two bones sit in the body's skeleton — `mixamorigNeck` and
 * `mixamorigHead`, bones 4 and 5 of 49 — and so which slots it must read.
 * Stated, like {@link SOLDIER_PARTS}, rather than looked up through the baker.
 */
const SOLDIER_SLOTS = { neck: 4, head: 5 }

/**
 * Where each of Soldier's two meshes lands in the merged vertex set — stated
 * as a fact about this asset, not recomputed by re-running the baker's
 * material-sorted merge. Mirroring that algorithm here would make the decode
 * check agree with whatever ordering the baker happens to produce; these
 * literals disagree loudly instead, which is the point of an oracle.
 */
const SOLDIER_PARTS = [
  { name: 'vanguard_Mesh', start: 0, count: 7325 },
  { name: 'vanguard_visor', start: 7325, count: 109 },
]

/** Where one source mesh lands in a bake's merged vertex set. */
interface Part {
  name: string
  start: number
  count: number
}

/**
 * The independent oracle every real-asset position check is held to: a second
 * copy of the asset, posed by three's own `AnimationMixer` and — where a mesh
 * is skinned — skinned by three's own `applyBoneTransform`, then taken into
 * root space. If the baker's hand-rolled skinning drifted from three's, this
 * is what notices.
 *
 * Every third row of every band the bake holds, at the sample times the baker
 * used, reached the same way; and every `stride`-th vertex of every part — a
 * prime, so the samples don't fall into step with the mesh's own vertex
 * layout, or 1 on a mesh too small to sample. `check` gets the bake's row and
 * merged vertex, and where three put that vertex.
 */
function expectMatchesMixer(
  oracle: { root: Object3D; clips: AnimationClip[] },
  parts: Part[],
  stride: number,
  vat: { vertexCount: number; clips: { name: string; startFrame: number; frames: number }[] },
  check: (row: number, v: number, expected: Vector3, at: string) => void,
): void {
  const mixer = new AnimationMixer(oracle.root)
  oracle.root.updateMatrixWorld(true)
  const rootInverse = oracle.root.matrixWorld.clone().invert()
  const meshes = parts.map((part) => {
    const mesh = oracle.root.getObjectByName(part.name) as Mesh | undefined
    if (!mesh) throw new Error(`the oracle has no mesh named "${part.name}"`)
    expect(mesh.geometry.attributes.position!.count).toBe(part.count)
    return { ...part, mesh }
  })
  expect(parts.reduce((n, p) => n + p.count, 0)).toBe(vat.vertexCount)

  const toRoot = new Matrix4()
  const expected = new Vector3()
  for (const band of vat.clips) {
    const clip = oracle.clips.find((c) => c.name === band.name)!
    const action = mixer.clipAction(clip)
    action.play()
    for (let f = 0; f < band.frames; f += 3) {
      mixer.setTime((f / band.frames) * clip.duration)
      oracle.root.updateMatrixWorld(true)
      for (const part of meshes) {
        toRoot.multiplyMatrices(rootInverse, part.mesh.matrixWorld)
        for (let v = 0; v < part.count; v += stride) {
          expected.fromBufferAttribute(part.mesh.geometry.attributes.position!, v)
          if ((part.mesh as SkinnedMesh).isSkinnedMesh) (part.mesh as SkinnedMesh).applyBoneTransform(v, expected)
          expected.applyMatrix4(toRoot)
          check(band.startFrame + f, part.start + v, expected, `${band.name} row ${f} vertex ${part.start + v}`)
        }
      }
    }
    // Stop before the next band, so its action alone poses the oracle.
    action.stop()
    mixer.uncacheAction(clip)
  }
}

/**
 * {@link expectMatchesMixer}'s check for a rig bake. Exactly what the shader
 * computes — four slots composed from their two texels, weight-summed, applied
 * to the part-local rest vertex — to four decimals.
 */
function expectRigAt(vat: RigVAT) {
  return (row: number, v: number, expected: Vector3, at: string) => {
    const actual = skinFromRig(vat, v, row).position
    expect(actual.x, at).toBeCloseTo(expected.x, 4)
    expect(actual.y, at).toBeCloseTo(expected.y, 4)
    expect(actual.z, at).toBeCloseTo(expected.z, 4)
  }
}

// The rig encoding on the real rig (ADR-0018): 49 bones, none bound at the
// origin, two parts on one skeleton. The fixtures prove the arithmetic; this
// proves it against an asset nobody hand-built. Ticket #54 pins its texels and
// the demo asset's refusal; what is here is the oracle the ticket that built
// the encoding named — Soldier baked both ways lands in one place.
describe.skipIf(assetMissing(SOLDIER))('Soldier under the rig encoding', () => {
  it('bakes a rig texture two texels per slot wide, and no vertex layers', async () => {
    const gltf = await loadGLTF(SOLDIER)
    const clips = gltf.animations.filter((c: any) => SOLDIER_CLIPS.includes(c.name))

    const vat = bakeVAT(gltf.scene, clips, { fps: 30, encoding: 'rig' })

    console.log({
      slotCount: vat.slotCount,
      width: vat.rigTexture.image.width,
      totalFrames: vat.totalFrames,
      kb: +((vat.rigTexture.image.data as Float32Array).byteLength / 1024).toFixed(1),
      clips: vat.clips.map((c) => ({ name: c.name, rows: c.frames, maxDelta: +c.maxDelta.toFixed(3) })),
    })

    // 49 slots: the body's 49 bones, and none for the visor. The loader hands
    // the visor its own two-bone `Skeleton`, but its two bones *are* the body's
    // neck and head — the same nodes, the same inverses — so the visor reads
    // the body's slots (#54; #53 had counted 51, keying on the skeleton object).
    expect(vat.slotCount).toBe(49)
    expect(vat.rigTexture.image.width).toBe(49 * 2)
    expect(vat.rigTexture.image.height).toBe(113)
    expect(vat.vertexCount).toBe(7434)
    expect(vat.geometry.attributes.skinIndex!.count).toBe(7434)
    // Every visor vertex is weighted onto the body's neck or head slot.
    const index = vat.geometry.attributes.skinIndex!
    const weight = vat.geometry.attributes.skinWeight!
    const visor = SOLDIER_PARTS[1]!
    const visorSlots = new Set<number>()
    for (let v = visor.start; v < visor.start + visor.count; v++) {
      for (let i = 0; i < 4; i++) if (weight.getComponent(v, i) !== 0) visorSlots.add(index.getComponent(v, i))
    }
    expect([...visorSlots].sort((a, b) => a - b)).toEqual([SOLDIER_SLOTS.neck, SOLDIER_SLOTS.head])
    expect(vat.clips.map((c) => c.name)).toEqual(SOLDIER_CLIPS)
    // The diagnostic keeps both of its edges on a real clip list.
    for (const name of MOVING) expect(vat.clips.find((c) => c.name === name)!.maxDelta).toBeGreaterThan(0.5)
    expect(vat.clips.find((c) => c.name === 'TPose')!.maxDelta).toBeLessThan(0.01)
  })

  it('composed and skinned on the CPU, reproduces what the mixer posed, vertex for vertex, on every clip', async () => {
    const gltf = await loadGLTF(SOLDIER)
    const clips = gltf.animations.filter((c: any) => SOLDIER_CLIPS.includes(c.name))
    const vat = bakeVAT(gltf.scene, clips, { fps: 30, encoding: 'rig' })

    // The same oracle the vertex bake is held to, here on all four clips, band
    // by band, the visor reading the body's slots.
    const oracle = await loadGLTF(SOLDIER)
    expectMatchesMixer({ root: oracle.scene, clips: oracle.animations }, SOLDIER_PARTS, 97, vat, expectRigAt(vat))
  })

  it('renders as a crowd on the WebGL path, on an InstancedMesh and on a BatchedMesh', async () => {
    // The real rig VAT through the same calls a page makes, compiled headlessly:
    // the ticket's demonstration, minus the pixels (those are the render check
    // recorded on #51, and the parity gate's rig case in #57).
    const gltf = await loadGLTF(SOLDIER)
    const clips = gltf.animations.filter((c: any) => SOLDIER_CLIPS.includes(c.name))
    const vat = bakeVAT(gltf.scene, clips, { fps: 30, encoding: 'rig' })
    const instances = vat.clips.map((clip, i) => ({ clip, startTime: -i * 0.3, speed: 1 }))

    const { mesh, playback } = createVATMesh(vat, instances)
    expect(mesh.count).toBe(4)
    expect(mesh.geometry).toBe(vat.geometry)
    // Two source materials, two patched materials, two draw calls — and the
    // depth material for the shadows, all reading the rig texture.
    const materials = mesh.material as Material[]
    expect(materials).toHaveLength(2)
    for (const material of [...materials, mesh.customDepthMaterial!, mesh.customDistanceMaterial!]) {
      const shader = compileVATMaterial(material)
      expect(shader.uniforms['uVatRigTex']?.value).toBe(vat.rigTexture)
      expect(shader.uniforms['uVatPlaybackTex']?.value).toBe(playback.texture)
      expect(shader.vertexShader).toContain('vatSkinMatrix( gl_InstanceID )')
    }

    // Sized to the real asset, whose index is far longer than the fixtures'.
    const batch = new BatchedMesh(4, vat.vertexCount, vat.geometry.getIndex()!.count, vat.materials[0]!)
    const geometryId = batch.addGeometry(vat.geometry)
    for (let i = 0; i < 4; i++) batch.addInstance(geometryId)
    const batched = patchVATMaterial(
      vat.materials[0]!.clone(),
      vat,
      createVATUniforms(),
      createVATPlaybackTexture(instances),
      batch,
    )
    expect(batch.geometry.getAttribute('skinIndex').count).toBeGreaterThanOrEqual(vat.vertexCount)
    expect(compileVATMaterial(batched).vertexShader).toContain(
      'vatSkinMatrix( int( getIndirectIndex( gl_DrawID ) ) )',
    )
  })

  it('bounds the same union of frames the vertex bake does, and reads the same maxDelta', async () => {
    const gltf = await loadGLTF(SOLDIER)
    const clips = gltf.animations.filter((c: any) => SOLDIER_CLIPS.includes(c.name))

    const delta = bakeVAT(gltf.scene, clips, { encoding: 'delta', fps: 30 })
    const rig = bakeVAT(gltf.scene, clips, { fps: 30, encoding: 'rig' })

    for (const axis of ['x', 'y', 'z'] as const) {
      expect(rig.bounds.min[axis]).toBeCloseTo(delta.bounds.min[axis], 4)
      expect(rig.bounds.max[axis]).toBeCloseTo(delta.bounds.max[axis], 4)
    }
    for (const [i, clip] of rig.clips.entries()) {
      expect(clip.maxDelta).toBeCloseTo(delta.clips[i]!.maxDelta, 4)
    }
  })

  // The rig texels, pinned, for the same reason the vertex texels are: the
  // oracle above samples every third row and every 97th vertex, and a slot it
  // never looked at can move under a rewrite of the slot loop. Allowed to move
  // deliberately — a change to the composition, to three, or to the asset —
  // and not under an optimisation.
  it('bakes the same rig texels it always has (digest pin)', async () => {
    const gltf = await loadGLTF(SOLDIER)
    const clips = gltf.animations.filter((c: any) => SOLDIER_CLIPS.includes(c.name))
    const vat = bakeVAT(gltf.scene, clips, { fps: 30, encoding: 'rig' })

    expect(digest(vat.rigTexture.image.data as Float32Array)).toBe(SOLDIER_DIGEST.rig)
  })
})

// The normal-mapped case (#78, ADR-0027). Soldier is textured but carries no
// normal map, so nothing above shows the rig decode's normal — or the tangent
// a normal map reads — against an asset that needs both. Michelle does: one
// 65-bone skinned mesh with a normal map on its body. The pixels are the
// render check recorded in ADR-0027; this pins the bake it ran on, and the
// skinning of the normal and tangent it depends on, against three's own.
const MICHELLE = 'test-assets/Michelle.glb'

describe.skipIf(assetMissing(MICHELLE))('Michelle under the default encoding (normal-mapped)', () => {
  it('is normal-mapped, and the default bakes it under the rig encoding', async () => {
    const gltf = await loadGLTF(MICHELLE)
    // Asked of the file, not the material: the loader cannot decode the
    // embedded images in Node, so the material comes back map-less here.
    const declared = gltf.parser.json.materials.filter((m: any) => m.normalTexture).map((m: any) => m.name)
    expect(declared).toEqual(['Ch03_Body'])

    const vat = bakeVAT(gltf.scene, gltf.animations, { fps: 30 })

    expect(vat.encoding).toBe('rig')
    const rig = vat as RigVAT
    expect(rig.vertexCount).toBe(16340)
    expect(rig.slotCount).toBe(65)
    expect(rig.rigTexture.image.width).toBe(65 * 2)
    expect(rig.rigTexture.image.height).toBe(549)
    // A normal map samples by `uv`, which the bake has to carry through.
    expect(rig.geometry.hasAttribute('uv')).toBe(true)
  })

  it('skins the normal and the tangent as three does, on every clip', async () => {
    // Tangents computed before the bake, as a caller would for a normal map
    // read through a tangent attribute rather than screen-space derivatives.
    const withTangents = (scene: Object3D) => {
      scene.traverse((o: any) => o.isMesh && o.geometry.computeTangents())
      return scene
    }
    const gltf = await loadGLTF(MICHELLE)
    const vat = bakeVAT(withTangents(gltf.scene), gltf.animations, { fps: 30 }) as RigVAT
    expect(vat.encoding).toBe('rig')
    expect(vat.geometry.hasAttribute('tangent')).toBe(true)

    // The oracle: a second copy posed by the mixer, its normal and tangent
    // put through three's own skin matrix — `bindMatrixInverse · Σ w·bone ·
    // bindMatrix`, what `skinnormal_vertex` applies — and then into root space.
    const oracle = await loadGLTF(MICHELLE)
    withTangents(oracle.scene)
    const mixer = new AnimationMixer(oracle.scene)
    oracle.scene.updateMatrixWorld(true)
    const mesh = oracle.scene.getObjectByProperty('isSkinnedMesh', true) as SkinnedMesh
    const rootInverse = oracle.scene.matrixWorld.clone().invert()
    const { skinIndex, skinWeight, normal, tangent } = mesh.geometry.attributes as Record<string, BufferAttribute>
    // One mesh, so its vertex v is the bake's vertex v, with no part offset.
    expect(mesh.geometry.attributes.position!.count).toBe(vat.vertexCount)

    const skin = new Matrix4()
    const bone = new Matrix4()
    const toRoot = new Matrix4()
    const expectedNormal = new Vector3()
    const expectedTangent = new Vector3()

    for (const band of vat.clips) {
      const clip = oracle.animations.find((c: any) => c.name === band.name)
      const action = mixer.clipAction(clip)
      action.play()
      for (let f = 0; f < band.frames; f += 7) {
        mixer.setTime((f / band.frames) * clip.duration)
        oracle.scene.updateMatrixWorld(true)
        toRoot.multiplyMatrices(rootInverse, mesh.matrixWorld)

        for (let v = 0; v < mesh.geometry.attributes.position!.count; v += 97) {
          skin.elements.fill(0)
          for (let i = 0; i < 4; i++) {
            const w = skinWeight!.getComponent(v, i)
            if (w === 0) continue
            const b = skinIndex!.getComponent(v, i)
            bone.multiplyMatrices(mesh.skeleton.bones[b]!.matrixWorld, mesh.skeleton.boneInverses[b]!)
            for (let e = 0; e < 16; e++) skin.elements[e]! += bone.elements[e]! * w
          }
          skin.premultiply(mesh.bindMatrixInverse).multiply(mesh.bindMatrix).premultiply(toRoot)
          expectedNormal.fromBufferAttribute(normal!, v).transformDirection(skin)
          expectedTangent.fromBufferAttribute(tangent!, v).transformDirection(skin)

          const actual = skinFromRig(vat, v, band.startFrame + f)
          const at = `${band.name} row ${f} vertex ${v}`
          // Unit vectors, so a dot product near one is an angle near zero:
          // 1 - 1e-5 is about a quarter of a degree.
          expect(actual.normal.dot(expectedNormal), at).toBeGreaterThan(1 - 1e-5)
          expect(actual.tangent!.dot(expectedTangent), at).toBeGreaterThan(1 - 1e-5)
        }
      }
      action.stop()
      mixer.uncacheAction(clip)
    }
  })
})

// FBX, the second supported format (ADR-0031, #99). The baker never learned
// FBX — it bakes a posed subtree, whoever loaded it — so these blocks hold two
// real FBX files to the oracle Soldier's are held to, loaded the way the usage
// guide tells a caller to: every mesh through `mergeVertices` first, because
// FBXLoader never builds an index, and Mixamo's empty `Take 001` filtered out.
const TAKE_001 = 'Take 001'

interface FBXAsset {
  path: string
  /** What the asset proves that the other cannot. */
  proves: string
  /** Every mesh's vertex count summed, as FBXLoader hands it over and after `mergeVertices`. */
  vertices: { unmerged: number; merged: number }
  /** The clips a bake is given, once `Take 001` is gone. */
  clips: string[]
  /**
   * Where each merged mesh lands in the bake's vertex set — stated, like
   * {@link SOLDIER_PARTS}, rather than recomputed from the baker's
   * material-sorted merge.
   */
  parts: Part[]
  /** The oracle's vertex stride: a prime, or every vertex of a mesh too small to sample. */
  stride: number
}

const FBX_ASSETS: FBXAsset[] = [
  {
    path: 'test-assets/Samba Dancing.fbx',
    proves: 'the common Mixamo export: two skinned meshes, non-indexed, and an empty Take 001',
    vertices: { unmerged: 165960, merged: 35440 },
    clips: ['mixamo.com'],
    parts: [
      { name: 'Alpha_Surface', start: 0, count: 22967 },
      { name: 'Alpha_Joints', start: 22967, count: 12473 },
    ],
    stride: 97,
  },
  {
    path: 'test-assets/RotationTest.fbx',
    proves: 'the pre- and post-rotation transform only FBX carries, on a rigid node-animated cube',
    vertices: { unmerged: 36, merged: 24 },
    clips: ['Cube|CubeAction'],
    parts: [{ name: 'Cube', start: 0, count: 24 }],
    stride: 1,
  },
]

/** An FBX file parsed as a page would parse it, every mesh's geometry as the loader built it. */
function loadFBX(path: string): Object3D & { animations: AnimationClip[] } {
  const buf = readFileSync(path)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  return new FBXLoader().parse(ab, '') as Object3D & { animations: AnimationClip[] }
}

function meshesIn(root: Object3D): Mesh[] {
  const meshes: Mesh[] = []
  root.traverse((o) => (o as Mesh).isMesh && meshes.push(o as Mesh))
  return meshes
}

const vertexTotal = (root: Object3D) =>
  meshesIn(root).reduce((n, mesh) => n + mesh.geometry.attributes.position!.count, 0)

/** Loaded as the usage guide's Loading FBX section says: merged, and without `Take 001`. */
function loadFBXForBaking(path: string) {
  const root = loadFBX(path)
  for (const mesh of meshesIn(root)) mesh.geometry = mergeVertices(mesh.geometry)
  return { root, clips: root.animations.filter((clip) => clip.name !== TAKE_001) }
}

for (const asset of FBX_ASSETS) {
  describe.skipIf(assetMissing(asset.path))(`${asset.path.split('/').pop()} end-to-end (FBX)`, () => {
    // FBXLoader asks TextureLoader for every texture the file names, and an
    // image load has no chance under Node. The bake only carries materials
    // through, so an empty texture stands in — for these blocks, and no others.
    let textureLoad: MockInstance<TextureLoader['load']> | undefined
    beforeAll(() => {
      textureLoad = vi.spyOn(TextureLoader.prototype, 'load').mockImplementation(() => new Texture())
    })
    afterAll(() => textureLoad?.mockRestore())

    it(`loads as ${asset.vertices.unmerged} vertices and merges to ${asset.vertices.merged}: ${asset.proves}`, () => {
      const root = loadFBX(asset.path)
      expect(vertexTotal(root)).toBe(asset.vertices.unmerged)
      for (const mesh of meshesIn(root)) expect(mesh.geometry.index).toBeNull()

      const { root: merged, clips } = loadFBXForBaking(asset.path)
      expect(vertexTotal(merged)).toBe(asset.vertices.merged)
      expect(clips.map((c) => c.name)).toEqual(asset.clips)
      // Where Mixamo's Take 001 is there, it is there with nothing in it.
      for (const take of root.animations.filter((c) => c.name === TAKE_001)) {
        expect(take.tracks).toHaveLength(0)
        expect(take.duration).toBe(0)
      }
    })

    it('takes the rig encoding under the default bake', () => {
      const { root, clips } = loadFBXForBaking(asset.path)
      const vat = bakeVAT(root, clips, { fps: 30 })
      expect(vat.encoding).toBe('rig')
      expect(vat.vertexCount).toBe(asset.vertices.merged)
      for (const clip of vat.clips) expect(clip.maxDelta).toBeGreaterThan(1)
    })

    it('composed and skinned on the CPU, reproduces what the mixer posed (rig encoding)', () => {
      const { root, clips } = loadFBXForBaking(asset.path)
      const vat = bakeVAT(root, clips, { fps: 30, encoding: 'rig' })
      // The four decimals Soldier's rig bake is held to. Samba is authored in
      // centimetres, a hundred times Soldier's scale, and still lands inside them.
      expectMatchesMixer(loadFBXForBaking(asset.path), asset.parts, asset.stride, vat, expectRigAt(vat))
    })

    it('reconstructs what the mixer posed as position + delta (vertex encoding)', () => {
      const { root, clips } = loadFBXForBaking(asset.path)
      const vat = bakeVAT(root, clips, { fps: 30, encoding: 'delta' })
      // The tolerance Soldier's vertex bake is held to, unchanged.
      expectMatchesMixer(loadFBXForBaking(asset.path), asset.parts, asset.stride, vat, (row, v, expected) =>
        expectDeltaClose(vat, row, v, expected, 0.5e-4),
      )
    })
  })
}
