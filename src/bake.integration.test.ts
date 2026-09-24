import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AnimationClip, AnimationMixer, BatchedMesh, Matrix4, NumberKeyframeTrack, Vector3 } from 'three'
import type { BufferAttribute, BufferGeometry, Material, Object3D, SkinnedMesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bakeVAT } from './bake.js'
import { createVATPlaybackTexture } from './instance-playback.js'
import { assetMissing, compileVATMaterial, deltaTexels, expectDeltaClose, skinFromRig } from './test-utils.js'
import type { RigVAT } from './types.js'
import { createVATMesh, createVATUniforms, patchVATMaterial } from './webgl.js'

// Real-asset tests. Both are skipped rather than failed when their asset is
// absent, so the library suite never depends on a large binary being present:
// RobotExpressive ships with examples/, Soldier is fetched on demand
// (`node scripts/fetch-test-assets.mjs`; see docs/test-assets.md). The one place
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

    // An independent oracle: a second copy of the asset, posed by three's own
    // AnimationMixer and skinned by three's own applyBoneTransform. If the
    // baker's hand-rolled skinning drifted from three's, this is what notices.
    const oracle = await loadGLTF(SOLDIER)
    const oracleClip = oracle.animations.find((c: any) => c.name === 'Walk')
    const mixer = new AnimationMixer(oracle.scene)
    mixer.clipAction(oracleClip).play()

    oracle.scene.updateMatrixWorld(true)
    const rootInverse = oracle.scene.matrixWorld.clone().invert()
    const parts = SOLDIER_PARTS.map((part) => ({ ...part, mesh: findMesh(oracle.scene, part.name) }))
    for (const part of parts) {
      expect(part.mesh.geometry.attributes.position!.count).toBe(part.count)
    }
    expect(parts.reduce((n, p) => n + p.count, 0)).toBe(vat.vertexCount)

    const frames = vat.clips[0]!.frames
    const toRoot = new Matrix4()
    const expected = new Vector3()

    // Every third row, and a prime vertex stride so the samples don't fall
    // into step with the mesh's own vertex layout. 97 also lands twice inside
    // the 109-vertex visor, so the second part is genuinely covered.
    for (let row = 0; row < frames; row += 3) {
      // The same sample times the baker used, reached the same way.
      mixer.setTime((row / frames) * oracleClip.duration)
      oracle.scene.updateMatrixWorld(true)

      for (const part of parts) {
        toRoot.multiplyMatrices(rootInverse, part.mesh.matrixWorld)
        for (let v = 0; v < part.count; v += 97) {
          expected.fromBufferAttribute(part.mesh.geometry.attributes.position!, v)
          part.mesh.applyBoneTransform(v, expected)
          expected.applyMatrix4(toRoot)

          // Exactly what the shader computes: position + delta — to the four
          // decimals three's own skinning is reproduced to, plus what the
          // half-float store costs the delta itself (#73).
          expectDeltaClose(vat, row, part.start + v, expected, 0.5e-4)
        }
      }
    }
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

function findMesh(root: Object3D, name: string): SkinnedMesh {
  const mesh = root.getObjectByName(name)
  if (!mesh) throw new Error(`Soldier.glb has no mesh named "${name}"`)
  return mesh as SkinnedMesh
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

    // The same independent oracle the vertex bake is held to: a second copy of
    // the asset, posed by three's own mixer, skinned by applyBoneTransform —
    // here on all four clips, band by band, the visor reading the body's slots.
    const oracle = await loadGLTF(SOLDIER)
    const mixer = new AnimationMixer(oracle.scene)
    oracle.scene.updateMatrixWorld(true)
    const rootInverse = oracle.scene.matrixWorld.clone().invert()
    const parts = SOLDIER_PARTS.map((part) => ({ ...part, mesh: findMesh(oracle.scene, part.name) }))

    const toRoot = new Matrix4()
    const expected = new Vector3()

    for (const band of vat.clips) {
      const oracleClip = oracle.animations.find((c: any) => c.name === band.name)
      const action = mixer.clipAction(oracleClip)
      action.play()

      // Every third row of the band, and a prime vertex stride, as the vertex
      // bake's oracle samples — 97 lands twice inside the 109-vertex visor.
      for (let f = 0; f < band.frames; f += 3) {
        mixer.setTime((f / band.frames) * oracleClip.duration)
        oracle.scene.updateMatrixWorld(true)

        for (const part of parts) {
          toRoot.multiplyMatrices(rootInverse, part.mesh.matrixWorld)
          for (let v = 0; v < part.count; v += 97) {
            expected.fromBufferAttribute(part.mesh.geometry.attributes.position!, v)
            part.mesh.applyBoneTransform(v, expected)
            expected.applyMatrix4(toRoot)

            // Exactly what the shader computes: four slots composed from their
            // two texels, weight-summed, applied to the part-local rest vertex.
            const actual = skinFromRig(vat, part.start + v, band.startFrame + f).position
            expect(actual.x, `${band.name} row ${f} vertex ${part.start + v}`).toBeCloseTo(expected.x, 4)
            expect(actual.y, `${band.name} row ${f} vertex ${part.start + v}`).toBeCloseTo(expected.y, 4)
            expect(actual.z, `${band.name} row ${f} vertex ${part.start + v}`).toBeCloseTo(expected.z, 4)
          }
        }
      }
      // Stop before the next band, so its action alone poses the oracle.
      action.stop()
      mixer.uncacheAction(oracleClip)
    }
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
