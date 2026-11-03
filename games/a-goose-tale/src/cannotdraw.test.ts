import { describe, expect, it } from 'vitest'
import { isDrawFailure, nextAfterFailure } from './cannotdraw'

describe('what a page cannot go on from', () => {
  // As a Xiaomi Mi 9 logged them, 2026-11-03.
  it.each([
    'THREE.WebGPURenderer: Async render pipeline creation failed (renderPipeline_ShellToonMaterial_37): Program link failed:\nAssertion failed: GVI',
    'THREE.WebGPURenderer: Compute pipeline creation failed (computePipeline_compute): Entry-point uses workgroup_size(256, 1, 1) that exceeds the maximum allowed',
    'THREE.WebGPURenderer: Uncaptured WebGPU GPUValidationError: [Invalid ComputePipeline "computePipeline_compute"] is invalid due to a previous error.',
    'THREE.WebGLProgram: Shader Error 1282 - VALIDATE_STATUS false\n\nProgram Info Log: Assertion failed: GVI',
  ])('stops for %s', (text) => {
    expect(isDrawFailure(text)).toBe(true)
  })

  // A phone that switches apps loses its GPU and comes back: no reason to give up on it.
  it.each(['THREE.GLTFLoader: Unknown extension "X".', 'known error for the check', 'Failed to load resource: the server responded with a status of 404', 'THREE.WebGPURenderer: WebGPU Device Lost:\n\nMessage: destroyed', ''])('plays on through %s', (text) => {
    expect(isDrawFailure(text)).toBe(false)
  })
})

describe('what a refusal leads to', () => {
  it('tries WebGL 2 from WebGPU, and only then gives up', () => {
    expect(nextAfterFailure('WebGPU')).toBe('try webgl')
    expect(nextAfterFailure('WebGL 2')).toBe('give up')
  })
})
