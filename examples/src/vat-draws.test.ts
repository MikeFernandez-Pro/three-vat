// The HUD's VAT draw calls are the crowd's and nobody else's, split by pass —
// pinned off stand-ins for the one call each renderer makes per draw. That the
// stand-ins are where three r186 really draws is the pages' to show.
import { describe, expect, it } from 'vitest'
import { countVATDraws, formatVATDraws } from './vat-draws.js'

const crowd = { name: 'crowd' }
const floor = { name: 'floor' }
const isVAT = (object: unknown) => object === crowd

function webgl() {
  const renderer = {
    isWebGLRenderer: true as const,
    info: { render: { calls: 0 } },
    renderBufferDirect(..._args: unknown[]) {
      renderer.info.render.calls++
    },
  }
  return renderer
}

function webgpu() {
  const scene = { overrideMaterial: null as unknown }
  const renderer = {
    info: {
      drawCalls: 0,
      update(_object: unknown) {
        renderer.info.drawCalls++
      },
    },
  }
  return { renderer, scene }
}

describe('on WebGL', () => {
  it("counts the crowd's draws, not the floor's, and the shadow map's apart", () => {
    const renderer = webgl()
    const take = countVATDraws(renderer, { overrideMaterial: null }, isVAT)
    const scene = {}
    renderer.renderBufferDirect(null, null, null, null, crowd, null) // the shadow map: no scene
    renderer.renderBufferDirect(null, null, null, null, floor, null)
    renderer.renderBufferDirect(null, scene, null, null, crowd, null)
    renderer.renderBufferDirect(null, scene, null, null, floor, null)

    expect(take()).toEqual({ main: 1, shadow: 1 })
    // Every draw still reached the renderer.
    expect(renderer.info.render.calls).toBe(4)
  })

  it('starts each frame from nothing', () => {
    const renderer = webgl()
    const take = countVATDraws(renderer, { overrideMaterial: null }, isVAT)
    renderer.renderBufferDirect(null, {}, null, null, crowd, null)
    take()
    expect(take()).toEqual({ main: 0, shadow: 0 })
  })
})

describe('on WebGPU', () => {
  it("reads the pass off the scene's override, so a nested shadow pass is not the main one", () => {
    const { renderer, scene } = webgpu()
    const take = countVATDraws(renderer, scene, isVAT)
    scene.overrideMaterial = { isShadowPassMaterial: true }
    renderer.info.update(crowd)
    renderer.info.update(floor)
    scene.overrideMaterial = null
    renderer.info.update(crowd)
    renderer.info.update(floor)

    expect(take()).toEqual({ main: 1, shadow: 1 })
    expect(renderer.info.drawCalls).toBe(4)
  })
})

describe('the readout', () => {
  it('says the shadow pass beside the main one, and nothing when there is none', () => {
    expect(formatVATDraws({ main: 1, shadow: 1 })).toBe('1 (+1 shadow)')
    expect(formatVATDraws({ main: 3, shadow: 0 })).toBe('3')
  })
})
