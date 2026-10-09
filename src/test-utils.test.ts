import { describe, expect, it } from 'vitest'
import { assetMissing, unassignedReads } from './test-utils.js'

describe('unassignedReads', () => {
  it('reads no declaration as a read, and still flags a read before any assignment', () => {
    // A compute pass with barriers declares its variables ahead of the flow.
    const wgsl = ['fn main( @builtin( local_invocation_index ) l : u32,', '\t@builtin( global_invocation_id ) g : vec3<u32> ) {', '\tvar nodeVar0 : u32;', '\tvar nodeVar1 : u32;', '\tnodeVar0 = l;', '\tnodeVar2 = nodeVar0 + nodeVar1;', '}'].join('\n')
    expect(unassignedReads(wgsl)).toEqual(['nodeVar1: nodeVar2 = nodeVar0 + nodeVar1;'])
  })
})

describe('assetMissing', () => {
  const present = 'package.json'
  const absent = 'test-assets/definitely-not-here.glb'

  it('is false for an asset that is there, CI or not', () => {
    expect(assetMissing(present, {})).toBe(false)
    expect(assetMissing(present, { CI: 'true' })).toBe(false)
  })

  it('skips a missing asset off CI', () => {
    expect(assetMissing(absent, {})).toBe(true)
  })

  it('throws for a missing asset on CI, naming the fetch script', () => {
    expect(() => assetMissing(absent, { CI: 'true' })).toThrow(/scripts\/fetch-test-assets\.mjs/)
    expect(() => assetMissing(absent, { CI: 'true' })).toThrow(/definitely-not-here/)
  })
})
