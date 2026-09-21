import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AnimationMixer, BatchedMesh, Matrix4, Vector3 } from 'three'
import type { Material, Object3D, SkinnedMesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bakeVAT } from './bake.js'
import { createVATPlaybackTexture } from './instance-playback.js'
import { assetMissing, compileVATMaterial, skinFromRig } from './test-utils.js'
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

describe.skipIf(assetMissing(SOLDIER))('Soldier end-to-end (skinned)', () => {
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
    const vat = bakeVAT(gltf.scene, clips, { fps: 30 })

    expect(digest(vat.positionTexture.image.data as Float32Array)).toBe(SOLDIER_DIGEST.position)
    expect(digest(vat.normalTexture!.image.data as Float32Array)).toBe(SOLDIER_DIGEST.normal)
  })
})

/**
 * SHA-256 over a texture's raw texels — the whole float buffer, byte for byte.
 */
function digest(data: Float32Array): string {
  return createHash('sha256')
    .update(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
    .digest('hex')
}

/** Soldier's baked texels at 30 fps, all four clips. See the digest test. */
const SOLDIER_DIGEST = {
  position: '50c7ed3944802511a0034bcd42a096ea7c720b7b0306651ce6195546688f9e54',
  normal: '42741f9bc76963e9c4e16c73c409d17513e9d6b522014c72d4f6ba21e71c08d2',
}

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

    // The body's 49-bone skeleton and the visor's own two-bone one: 51 slots,
    // the number the prototype measured (#47).
    expect(vat.slotCount).toBe(51)
    expect(vat.rigTexture.image.width).toBe(51 * 2)
    expect(vat.rigTexture.image.height).toBe(113)
    expect(vat.vertexCount).toBe(7434)
    expect(vat.geometry.attributes.skinIndex!.count).toBe(7434)
    expect(vat.clips.map((c) => c.name)).toEqual(SOLDIER_CLIPS)
    // The diagnostic keeps both of its edges on a real clip list.
    for (const name of MOVING) expect(vat.clips.find((c) => c.name === name)!.maxDelta).toBeGreaterThan(0.5)
    expect(vat.clips.find((c) => c.name === 'TPose')!.maxDelta).toBeLessThan(0.01)
  })

  it('composed and skinned on the CPU, reproduces what the mixer posed, vertex for vertex', async () => {
    const gltf = await loadGLTF(SOLDIER)
    const clip = gltf.animations.find((c: any) => c.name === 'Walk')
    const vat = bakeVAT(gltf.scene, [clip], { fps: 30, encoding: 'rig' })

    // The same independent oracle the vertex bake is held to: a second copy of
    // the asset, posed by three's own mixer, skinned by applyBoneTransform.
    const oracle = await loadGLTF(SOLDIER)
    const oracleClip = oracle.animations.find((c: any) => c.name === 'Walk')
    const mixer = new AnimationMixer(oracle.scene)
    mixer.clipAction(oracleClip).play()
    oracle.scene.updateMatrixWorld(true)
    const rootInverse = oracle.scene.matrixWorld.clone().invert()
    const parts = SOLDIER_PARTS.map((part) => ({ ...part, mesh: findMesh(oracle.scene, part.name) }))

    const frames = vat.clips[0]!.frames
    const toRoot = new Matrix4()
    const expected = new Vector3()

    for (let row = 0; row < frames; row += 3) {
      mixer.setTime((row / frames) * oracleClip.duration)
      oracle.scene.updateMatrixWorld(true)

      for (const part of parts) {
        toRoot.multiplyMatrices(rootInverse, part.mesh.matrixWorld)
        for (let v = 0; v < part.count; v += 97) {
          expected.fromBufferAttribute(part.mesh.geometry.attributes.position!, v)
          part.mesh.applyBoneTransform(v, expected)
          expected.applyMatrix4(toRoot)

          // Exactly what the shader computes: four slots composed from their
          // two texels, weight-summed, applied to the part-local rest vertex.
          const actual = skinFromRig(vat, part.start + v, row).position
          expect(actual.x).toBeCloseTo(expected.x, 4)
          expect(actual.y).toBeCloseTo(expected.y, 4)
          expect(actual.z).toBeCloseTo(expected.z, 4)
        }
      }
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

    const delta = bakeVAT(gltf.scene, clips, { fps: 30 })
    const rig = bakeVAT(gltf.scene, clips, { fps: 30, encoding: 'rig' })

    for (const axis of ['x', 'y', 'z'] as const) {
      expect(rig.bounds.min[axis]).toBeCloseTo(delta.bounds.min[axis], 4)
      expect(rig.bounds.max[axis]).toBeCloseTo(delta.bounds.max[axis], 4)
    }
    for (const [i, clip] of rig.clips.entries()) {
      expect(clip.maxDelta).toBeCloseTo(delta.clips[i]!.maxDelta, 4)
    }
  })
})
