// The deform pages' twist eases in off the geometry's own `position.y`, against
// a knee and a span taken as fractions of the baked bounds. Both have to be in
// one space, or the crowd stands still while the marker and the readout follow
// the pointer: the pages are drawn by a GPU no test here has, and the figure
// beside them is computed on the CPU, so nothing else notices. That is how the
// pair went still when the default encoding became the rig (#75), which keeps
// the bind pose in `position` — a hundredth of Soldier's height.
//
// The pages are self-contained recipes (ADR-0037), so their bake is read off
// their own source: the encoding they name and the two fractions they declare.
// Then Soldier is baked as they bake it, and its rest pose is required to reach
// past both ends of the twist: feet below the knee, head above the shoulder.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bakeVAT } from 'three-vat'

const PAGES = ['examples/src/webgl_deform.ts', 'examples/src/webgpu_deform.ts']

/** What a deform page says about its bake: the encoding it names, and its knee and span. */
function bakeOf(path: string) {
  const code = readFileSync(path, 'utf8')
  const fraction = (name: string) => Number(new RegExp(`const ${name} = ([\\d.]+);`).exec(code)?.[1])
  return {
    encoding: /bakeVAT\([^)]*\bencoding: "(\w+)"/.exec(code)?.[1],
    knee: fraction('KNEE'),
    span: fraction('SPAN'),
  }
}

async function loadSoldier() {
  // GLTFLoader reads `self.URL` to turn Soldier's embedded textures into blob
  // URLs; the image load fails in Node and is swallowed, which a bake survives.
  ;(globalThis as { self?: unknown }).self = globalThis
  const buf = readFileSync('examples/public/Soldier.glb')
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const gltf = await new Promise<any>((res, rej) => new GLTFLoader().parse(ab, '', res, rej))
  gltf.scene.updateMatrixWorld(true)
  return { root: gltf.scene, idle: gltf.animations.find((c: any) => c.name === 'Idle') }
}

describe('the deform pages twist the soldier they bake', () => {
  const bakes = PAGES.map(bakeOf)

  it('read the same bake off both pages, under the vertex encoding', () => {
    expect(bakes[0]).toEqual(bakes[1])
    expect(bakes[0]!.encoding).toBe('delta')
    expect(bakes[0]!.knee).toBeGreaterThan(0)
    expect(bakes[0]!.span).toBeGreaterThan(0)
  })

  it('bakes a rest pose that spans the twist, knee to shoulder', async () => {
    const { knee: kneeAt, span: spanOf, encoding } = bakes[0]!
    const { root, idle } = await loadSoldier()
    const vat = bakeVAT(root, [idle], { encoding: encoding as 'delta' })
    const height = vat.bounds.max.y - vat.bounds.min.y
    const knee = vat.bounds.min.y + height * kneeAt
    const span = height * spanOf

    vat.geometry.computeBoundingBox()
    const rest = vat.geometry.boundingBox!
    expect(rest.min.y).toBeLessThan(knee)
    expect(rest.max.y).toBeGreaterThan(knee + span)
  })
})
