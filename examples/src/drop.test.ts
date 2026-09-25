// Guards what the drop pages decide before anything is loaded: which file of a
// drop is the asset, in which format, where each resource a .gltf names sits
// in the drop, and what a drop the page does not take is told. Asserted on
// plain file sets, as a visitor's drop arrives, because the page's answer to
// "will it take my file?" is the first thing it says.
import { describe, expect, it } from 'vitest'
import { SUPPORTED_EXTENSIONS, clipChoices, defaultChoices, playbackOf, resolveDrop, spiralCell } from './drop.js'

/** A dropped file, as the page hands one over: its path in the drop, and its text on demand. */
const file = (path: string, text = '') => ({ path, text: async () => text })

/** A `.gltf` naming these buffers and images by URI, as an exporter writes one. */
const gltf = (path: string, { buffers = [] as string[], images = [] as string[] } = {}) =>
  file(
    path,
    JSON.stringify({
      asset: { version: '2.0' },
      buffers: buffers.map((uri) => ({ uri, byteLength: 4 })),
      images: images.map((uri) => ({ uri })),
    }),
  )

describe('resolveDrop', () => {
  it('takes a lone .glb as the asset, in glTF, with nothing outside it', async () => {
    const glb = file('Soldier.glb')
    expect(await resolveDrop([glb])).toEqual({ ok: true, entry: glb, format: 'gltf', resources: new Map(), warnings: [] })
  })

  it('takes an .fbx as the asset, in FBX', async () => {
    const fbx = file('Samba Dancing.fbx')
    expect(await resolveDrop([fbx])).toMatchObject({ ok: true, entry: fbx, format: 'fbx', warnings: [] })
  })

  it('reads the extension whatever its case', async () => {
    expect(await resolveDrop([file('SOLDIER.GLB')])).toMatchObject({ ok: true, format: 'gltf' })
  })

  it('refuses a set with no supported entry, naming the formats it takes', async () => {
    for (const set of [[file('robot.obj')], [file('albedo.png')]]) {
      const result = await resolveDrop(set)
      expect(result.ok).toBe(false)
      if (result.ok) continue
      for (const extension of ['.glb', '.gltf', '.fbx']) expect(result.refusal).toContain(extension)
      expect(result.refusal).toContain(set[0]!.path)
    }
  })

  it('refuses an empty drop rather than resolving nothing', async () => {
    expect((await resolveDrop([])).ok).toBe(false)
  })

  it('names glTF and FBX as the supported extensions (ADR-0031)', () => {
    expect([...SUPPORTED_EXTENSIONS]).toEqual(['.glb', '.gltf', '.fbx'])
  })
})

describe('resolveDrop, for a .gltf and the files it names', () => {
  it('finds the .bin and the textures dropped beside it', async () => {
    const entry = gltf('Robot.gltf', { buffers: ['Robot.bin'], images: ['albedo.png', 'normal.jpg'] })
    const bin = file('Robot.bin')
    const albedo = file('albedo.png')
    const normal = file('normal.jpg')
    const result = await resolveDrop([albedo, entry, bin, normal])

    expect(result).toMatchObject({ ok: true, entry, format: 'gltf', warnings: [] })
    // Keyed by each URI as the .gltf writes it: what the loader hands the
    // LoadingManager's URL modifier.
    expect(result.ok && result.resources).toEqual(
      new Map([
        ['Robot.bin', bin],
        ['albedo.png', albedo],
        ['normal.jpg', normal],
      ]),
    )
  })

  it("resolves a folder's nested paths against the .gltf's own folder", async () => {
    const entry = gltf('robot/scene.gltf', { buffers: ['scene.bin'], images: ['textures/albedo.png', './textures/rough.png'] })
    const bin = file('robot/scene.bin')
    const albedo = file('robot/textures/albedo.png')
    const rough = file('robot/textures/rough.png')
    const result = await resolveDrop([bin, albedo, rough, entry])

    expect(result).toMatchObject({ ok: true, entry, warnings: [] })
    if (!result.ok) return
    expect(result.resources.get('scene.bin')).toBe(bin)
    expect(result.resources.get('textures/albedo.png')).toBe(albedo)
    expect(result.resources.get('./textures/rough.png')).toBe(rough)
  })

  it("follows a path that climbs out of the .gltf's folder", async () => {
    const entry = gltf('export/gltf/scene.gltf', { buffers: ['../bin/scene.bin'] })
    const bin = file('export/bin/scene.bin')
    const result = await resolveDrop([entry, bin])

    expect(result.ok && result.resources.get('../bin/scene.bin')).toBe(bin)
  })

  it('decodes a percent-encoded URI to the file name it stands for', async () => {
    const entry = gltf('Robot.gltf', { buffers: ['Robot.bin'], images: ['Robot%20albedo.png'] })
    const albedo = file('Robot albedo.png')
    const result = await resolveDrop([entry, file('Robot.bin'), albedo])

    expect(result.ok && result.resources.get('Robot%20albedo.png')).toBe(albedo)
  })

  it('finds a texture dropped loose beside the .gltf rather than in its folder', async () => {
    // Several files picked at once arrive flat: the .gltf says
    // `textures/albedo.png`, and the drop has only `albedo.png`.
    const entry = gltf('Robot.gltf', { buffers: ['Robot.bin'], images: ['textures/albedo.png'] })
    const albedo = file('albedo.png')
    const result = await resolveDrop([entry, file('Robot.bin'), albedo])

    expect(result).toMatchObject({ ok: true, warnings: [] })
    expect(result.ok && result.resources.get('textures/albedo.png')).toBe(albedo)
  })

  it('warns by name about a texture the drop lacks, and still resolves', async () => {
    const entry = gltf('Robot.gltf', { buffers: ['Robot.bin'], images: ['albedo.png', 'textures/normal.png'] })
    const result = await resolveDrop([entry, file('Robot.bin'), file('albedo.png')])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('textures/normal.png')
    // Answered as missing, so the page stands a blank image in for it rather
    // than let the loader go looking for it on the network.
    expect(result.resources.has('textures/normal.png')).toBe(true)
    expect(result.resources.get('textures/normal.png')).toBeNull()
  })

  it('refuses a .gltf whose .bin the drop lacks, naming it', async () => {
    // There is no geometry to bake without it: a warning would only put the
    // loader's RangeError on the page a moment later.
    const result = await resolveDrop([gltf('Robot.gltf', { buffers: ['Robot.bin'] })])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal).toContain('Robot.bin')
  })

  it('names a missing .bin once, however many buffers point at it', async () => {
    const result = await resolveDrop([gltf('Robot.gltf', { buffers: ['Robot.bin', 'Robot.bin'] })])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal.split('Robot.bin')).toHaveLength(2)
  })

  it('leaves embedded data URIs to the loader', async () => {
    const inline = 'data:application/octet-stream;base64,AAAAAA=='
    const result = await resolveDrop([gltf('Box.gltf', { buffers: [inline], images: ['data:image/png;base64,AA=='] })])

    expect(result).toMatchObject({ ok: true, warnings: [] })
    expect(result.ok && result.resources.size).toBe(0)
  })

  it('leaves a .gltf that is not JSON to the loader, whose message says why', async () => {
    expect(await resolveDrop([file('broken.gltf', 'not json')])).toMatchObject({ ok: true, warnings: [] })
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
