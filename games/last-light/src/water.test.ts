// The pond's water: its shader builds, every value it reads written first.
import { describe, expect, it } from 'vitest'
import { DataTexture, Mesh } from 'three/webgpu'
import { fragmentWGSL, unassignedReads, vertexWGSL } from '../../../src/test-utils'
import { plain } from './plain'
import { defaultPondLook, waterGeometry } from './pond'
import { waterOf } from './water'

describe("the pond's water", () => {
  it('builds its shader for WebGPU, nothing read before it is written', () => {
    const blank = () => new DataTexture(new Uint8Array(4), 1, 1)
    const { material } = waterOf({ perlin: blank() })
    const pond = defaultPondLook(plain(3, { burnRate: 1 / 25, pace: 2 }).pond)
    const mesh = new Mesh(waterGeometry(pond), material)
    const fragment = fragmentWGSL(mesh, material)
    expect(fragment).toContain('fn main')
    expect(unassignedReads(fragment)).toEqual([])
    expect(unassignedReads(vertexWGSL(mesh, material))).toEqual([])
  })
})
