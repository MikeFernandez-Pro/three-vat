import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AnimationMixer, Matrix4, Vector3 } from 'three'
import type { Object3D, SkinnedMesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bakeVAT } from './bake.js'

// Real-asset tests. Both are skipped rather than failed when their asset is
// absent, so the library suite never depends on a large binary being present:
// RobotExpressive ships with examples/, Soldier is fetched on demand
// (`pnpm fetch:test-assets`; see docs/test-assets.md).
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
describe.skipIf(!existsSync(ROBOT))('RobotExpressive end-to-end', () => {
  it('bakes the real multi-part rigid hierarchy with non-zero deltas', async () => {
    const gltf = await loadGLTF(ROBOT)
    const clips = gltf.animations.filter((c: any) => ROBOT_CLIPS.includes(c.name))
    expect(clips).toHaveLength(5)

    const vat = bakeVAT(gltf.scene, clips, { fps: 30 })

    console.log({
      vertexCount: vat.vertexCount,
      totalFrames: vat.totalFrames,
      materials: vat.materials.length,
      groups: vat.geometry.groups.length,
      mb: +((vat.vertexCount * vat.totalFrames * 16 * 2) / 1048576).toFixed(1),
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
    const vat = bakeVAT(gltf.scene, clips, { fps: 30 })

    const pos = vat.geometry.attributes.position!
    const data = vat.positionTexture.image.data as Float32Array
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

describe.skipIf(!existsSync(SOLDIER))('Soldier end-to-end (skinned)', () => {
  it('bakes a real 49-bone skinned character', async () => {
    const gltf = await loadGLTF(SOLDIER)
    const clips = gltf.animations.filter((c: any) => SOLDIER_CLIPS.includes(c.name))
    expect(clips).toHaveLength(4)

    const vat = bakeVAT(gltf.scene, clips, { fps: 30 })

    console.log({
      vertexCount: vat.vertexCount,
      totalFrames: vat.totalFrames,
      materials: vat.materials.length,
      groups: vat.geometry.groups.length,
      mb: +((vat.vertexCount * vat.totalFrames * 16 * 2) / 1048576).toFixed(1),
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
    const vat = bakeVAT(gltf.scene, clips, { fps: 30 })

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
    const vat = bakeVAT(gltf.scene, [clip], { fps: 30 })

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

    const pos = vat.geometry.attributes.position!
    const data = vat.positionTexture.image.data as Float32Array
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

          const vi = part.start + v
          const o = (row * vat.vertexCount + vi) * 4
          // Exactly what the shader computes: position + delta.
          expect(pos.getX(vi) + data[o]!).toBeCloseTo(expected.x, 4)
          expect(pos.getY(vi) + data[o + 1]!).toBeCloseTo(expected.y, 4)
          expect(pos.getZ(vi) + data[o + 2]!).toBeCloseTo(expected.z, 4)
        }
      }
    }
  })
})

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
