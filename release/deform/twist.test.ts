// The deform pages' twist eases in off the geometry's own `position.y`, against
// a knee and a span read off the baked bounds. Both have to be in one space, or
// the crowd stands still while the marker and the readout follow the pointer:
// the pages are drawn by a GPU no test here has, and the figures beside them
// are computed on the CPU, so nothing else notices. That is how the pair went
// still when the default encoding became the rig (#75), which keeps the bind
// pose in `position`, a hundredth of a unit tall on the robot.
//
// So the bake is done as the pages do it, off the same options, and its rest
// pose is required to reach past both ends of the twist: feet below the knee,
// head above the shoulder.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bakeVAT } from 'three-vat'
import { CLIP_NAMES } from '../../examples/src/assets.js'
import { TWIST_BAKE, twistProfile } from '../../examples/src/deforming.js'

async function loadRobot() {
  // GLTFLoader reads `self.URL` for embedded textures; the robot embeds none,
  // but the loader looks before it knows.
  ;(globalThis as { self?: unknown }).self = globalThis
  const buf = readFileSync('examples/public/RobotExpressive.glb')
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const gltf = await new Promise<any>((res, rej) => new GLTFLoader().parse(ab, '', res, rej))
  gltf.scene.updateMatrixWorld(true)
  return { root: gltf.scene, clips: gltf.animations.filter((c: any) => CLIP_NAMES.includes(c.name)) }
}

describe('the deform pages twist the robot they bake', () => {
  it('bakes a rest pose that spans the twist, knee to shoulder', async () => {
    const robot = await loadRobot()
    const vat = bakeVAT(robot.root, robot.clips, TWIST_BAKE)
    const { knee, span } = twistProfile(vat.bounds.min.y, vat.bounds.max.y - vat.bounds.min.y)

    vat.geometry.computeBoundingBox()
    const rest = vat.geometry.boundingBox!
    expect(rest.min.y).toBeLessThan(knee)
    expect(rest.max.y).toBeGreaterThan(knee + span)
  })
})
