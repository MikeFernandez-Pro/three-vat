import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bakeVAT } from './bake.js'

// Real-asset regression guard for ADR-0008: RobotExpressive is a rigid,
// node-animated hierarchy, which the pre-ADR single-mesh baker bakes as a
// frozen pose. Skipped rather than failed when the demo asset is absent, so
// the library suite never depends on examples/ being present.
const ASSET = 'examples/public/RobotExpressive.glb'
const CLIPS = ['Idle', 'Walking', 'Running', 'Dance', 'Wave']

async function loadRobot() {
  const buf = readFileSync(ASSET)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const loader = new GLTFLoader()
  return await new Promise<any>((res, rej) => loader.parse(ab, '', res, rej))
}

describe.skipIf(!existsSync(ASSET))('RobotExpressive end-to-end', () => {
  it('bakes the real multi-part rigid hierarchy with non-zero deltas', async () => {
    const gltf = await loadRobot()
    const clips = gltf.animations.filter((c: any) => CLIPS.includes(c.name))
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
    const gltf = await loadRobot()
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
