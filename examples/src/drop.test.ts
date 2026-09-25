// Guards what the drop pages decide before anything is loaded: which file of a
// drop is the asset, in which format, and what a drop the page does not take
// is told. Asserted on plain file sets, as a visitor's drop arrives, because
// the page's answer to "will it take my file?" is the first thing it says.
import { describe, expect, it } from 'vitest'
import { SUPPORTED_EXTENSIONS, clipChoices, defaultChoices, playbackOf, resolveDrop, spiralCell } from './drop.js'

const file = (path: string) => ({ path })

describe('resolveDrop', () => {
  it('takes a lone .glb as the asset, in glTF', () => {
    const glb = file('Soldier.glb')
    expect(resolveDrop([glb])).toEqual({ ok: true, entry: glb, format: 'gltf' })
  })

  it('takes an .fbx as the asset, in FBX', () => {
    const fbx = file('Samba Dancing.fbx')
    expect(resolveDrop([fbx])).toEqual({ ok: true, entry: fbx, format: 'fbx' })
  })

  it('reads the extension whatever its case', () => {
    expect(resolveDrop([file('SOLDIER.GLB')])).toMatchObject({ ok: true, format: 'gltf' })
  })

  it('refuses a set with no supported entry, naming the formats it takes', () => {
    for (const set of [[file('robot.obj')], [file('albedo.png')]]) {
      const result = resolveDrop(set)
      expect(result.ok).toBe(false)
      if (result.ok) continue
      for (const extension of ['.glb', '.gltf', '.fbx']) expect(result.refusal).toContain(extension)
      expect(result.refusal).toContain(set[0]!.path)
    }
  })

  it('refuses an empty drop rather than resolving nothing', () => {
    expect(resolveDrop([]).ok).toBe(false)
  })

  it('names glTF and FBX as the supported extensions (ADR-0031)', () => {
    expect([...SUPPORTED_EXTENSIONS]).toEqual(['.glb', '.gltf', '.fbx'])
  })
})

describe('defaultChoices', () => {
  it('merges an FBX by default: FBXLoader never builds an index', () => {
    expect(defaultChoices('fbx').mergeVertices).toBe(true)
  })

  it('offers no merge for glTF, whose loader keeps the index', () => {
    expect(defaultChoices('gltf')).not.toHaveProperty('mergeVertices')
  })
})

describe('spiralCell', () => {
  const cells = (n: number) => Array.from({ length: n }, (_, i) => spiralCell(i))

  it('stands the first instance at the centre', () => {
    expect(spiralCell(0)).toEqual({ x: 0, z: 0 })
  })

  it('fills the square around the centre before starting the next', () => {
    // So any count is a crowd gathered round the middle, not a line.
    for (const side of [3, 5, 7]) {
      const half = (side - 1) / 2
      for (const { x, z } of cells(side * side)) {
        expect(Math.abs(x)).toBeLessThanOrEqual(half)
        expect(Math.abs(z)).toBeLessThanOrEqual(half)
      }
    }
  })

  it('never puts two instances in one cell', () => {
    const seen = new Set(cells(1000).map(({ x, z }) => `${x},${z}`))
    expect(seen.size).toBe(1000)
  })
})

describe('playbackOf', () => {
  const clips = [
    { name: 'Idle', duration: 2 },
    { name: 'Walk', duration: 1 },
    { name: 'Run', duration: 0.7 },
  ]
  const crowd = Array.from({ length: 200 }, (_, i) => playbackOf(i, clips)!)

  it('plays every clip somewhere in the crowd, not one clip in step', () => {
    expect(new Set(crowd.map((p) => p.clip.name))).toEqual(new Set(clips.map((c) => c.name)))
  })

  it('starts each instance at a phase inside its own clip', () => {
    for (const { clip, startTime } of crowd) {
      expect(startTime).toBeLessThanOrEqual(0)
      expect(startTime).toBeGreaterThan(-clip.duration)
    }
    expect(new Set(crowd.map((p) => p.startTime)).size).toBeGreaterThan(100)
  })

  it('gives an instance the same playback every time it is asked', () => {
    // So a crowd rebuilt from the same bake is the same crowd.
    expect(playbackOf(17, clips)).toEqual(playbackOf(17, clips))
  })

  it('has nothing to play for an asset with no clips', () => {
    expect(playbackOf(0, [])).toBeNull()
  })
})

describe('clipChoices', () => {
  // Plain clip facts, as the page reads them off the loaded AnimationClips.
  const clip = (name: string, duration: number, trackCount: number) => ({ name, duration, trackCount })

  it('starts a clip that animates checked, with no reason to give', () => {
    expect(clipChoices([clip('Walk', 1.2, 52)])).toEqual([{ name: 'Walk', checked: true, reason: null }])
  })

  it("starts Mixamo's Take 001 unchecked, and says it is empty", () => {
    // Zero duration and no tracks: baked, it would be a frozen band of the rest pose.
    const [take] = clipChoices([clip('Take 001', 0, 0)])
    expect(take).toMatchObject({ name: 'Take 001', checked: false })
    expect(take!.reason).toMatch(/empty/)
    expect(take!.reason).toMatch(/no tracks/)
    expect(take!.reason).toMatch(/0 s/)
  })

  it('treats a clip as empty on either count alone', () => {
    const [noTracks, noTime] = clipChoices([clip('Pose', 2, 0), clip('Blink', 0, 3)])
    expect(noTracks).toMatchObject({ checked: false, reason: expect.stringMatching(/no tracks/) })
    expect(noTime).toMatchObject({ checked: false, reason: expect.stringMatching(/0 s/) })
  })

  it('answers every clip, in the order it was given', () => {
    const choices = clipChoices([clip('Take 001', 0, 0), clip('Samba', 12.5, 65)])
    expect(choices.map((c) => [c.name, c.checked])).toEqual([
      ['Take 001', false],
      ['Samba', true],
    ])
  })

  it('has no choices to offer an asset with no clips', () => {
    expect(clipChoices([])).toEqual([])
  })
})
