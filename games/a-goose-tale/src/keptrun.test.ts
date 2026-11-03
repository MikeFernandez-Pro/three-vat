import { describe, expect, it } from 'vitest'
import { dropKeptRun, keepRun, keptRun } from './keptrun'
import type { PlaySave } from './gooseplay'

function memory(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const items = new Map<string, string>()
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  }
}

const RUN: PlaySave = { found: [0, 2], keys: [1], armed: true, restAt: { x: 1.5, z: -2 } }

describe('the kept run', () => {
  it('comes back as it was kept', () => {
    const storage = memory()
    keepRun(RUN, storage)
    expect(keptRun(storage)).toEqual(RUN)
  })

  it('is gone once dropped, and none is there to start with', () => {
    const storage = memory()
    expect(keptRun(storage)).toBeUndefined()
    keepRun(RUN, storage)
    dropKeptRun(storage)
    expect(keptRun(storage)).toBeUndefined()
  })

  it.each(['not json', '{}', 'null', '{"found":[0],"keys":[],"armed":true}', '{"found":["a"],"keys":[],"armed":true,"restAt":{"x":1,"z":2}}', '{"found":[],"keys":[],"armed":true,"restAt":{"x":null,"z":2}}'])('reads %s as nothing', (stored) => {
    const storage = memory()
    storage.setItem('a-goose-tale.run', stored)
    expect(keptRun(storage)).toBeUndefined()
  })

  it('plays on where the storage refuses', () => {
    const refusing = {
      getItem: () => {
        throw new Error('no')
      },
      setItem: () => {
        throw new Error('no')
      },
      removeItem: () => {
        throw new Error('no')
      },
    }
    expect(keptRun(refusing)).toBeUndefined()
    expect(() => keepRun(RUN, refusing)).not.toThrow()
    expect(() => dropKeptRun(refusing)).not.toThrow()
  })
})
