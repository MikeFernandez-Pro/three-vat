// Guards what the drop pages decide before anything is loaded: which file of a
// drop is the asset, in which format, where each resource a .gltf names sits
// in the drop, and what a drop the page does not take is told. Asserted on
// plain file sets, as a visitor's drop arrives, because the page's answer to
// "will it take my file?" is the first thing it says.
import { describe, expect, it } from 'vitest'
import {
  GALLERY_URL,
  SUPPORTED_EXTENSIONS,
  clipChoices,
  defaultChoices,
  playbackOf,
  resolveDrop,
  snippetOf,
  spiralCell,
  type SnippetInput,
} from './drop.js'
import { BAKE_DEFAULTS, createDropParams } from './params.js'

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

describe('snippetOf', () => {
  /** What the page hands over after a bake: Soldier as it opens, unless a test says otherwise. */
  const input = (over: Partial<SnippetInput> = {}): SnippetInput => ({
    asset: 'Soldier.glb',
    format: 'gltf',
    choices: {},
    bake: { ...BAKE_DEFAULTS },
    clips: ['Idle', 'Run', 'TPose', 'Walk'].map((name) => ({ name, checked: true })),
    renderer: 'webgl',
    ...over,
  })

  it('bakes with nothing but the root and the clips when every choice is a default', () => {
    const code = snippetOf(input())
    expect(code).toContain('bakeVAT(root, clips)')
    expect(code).not.toMatch(/bakeVAT\(root, clips, /)
  })

  it('opens bare on the page as it opens: the panel starts on the defaults', () => {
    const { fps, encoding, mergeFlatMaterials } = createDropParams()
    expect(snippetOf(input({ bake: { fps, encoding, mergeFlatMaterials } }))).toContain('bakeVAT(root, clips)\n')
  })

  it('writes each changed option, and only those', () => {
    expect(snippetOf(input({ bake: { ...BAKE_DEFAULTS, fps: 24 } }))).toContain('bakeVAT(root, clips, { fps: 24 })')
    expect(snippetOf(input({ bake: { ...BAKE_DEFAULTS, encoding: 'delta' } }))).toContain(
      "bakeVAT(root, clips, { encoding: 'delta' })",
    )
    expect(snippetOf(input({ bake: { fps: 60, encoding: 'rig', mergeFlatMaterials: true } }))).toContain(
      "bakeVAT(root, clips, { fps: 60, encoding: 'rig', mergeFlatMaterials: true })",
    )
  })

  it('bakes every clip as loaded when every clip is checked', () => {
    expect(snippetOf(input())).toContain('const clips = gltf.animations\n')
  })

  it('names the checked clips, and only those, when some are left out', () => {
    const code = snippetOf(
      input({
        clips: [
          { name: 'Idle', checked: true },
          { name: 'TPose', checked: false },
          { name: 'Walk', checked: true },
        ],
      }),
    )
    expect(code).toContain("['Idle', 'Walk'].includes(clip.name)")
    expect(code).not.toContain("'TPose'")
  })

  it('bakes no clips when none is checked, and still has an instance to draw', () => {
    const code = snippetOf(input({ clips: [{ name: 'Idle', checked: false }] }))
    expect(code).toContain('bakeVAT(root, [])')
    expect(code).not.toContain('vat.clips.map')
  })

  it('loads a glTF with GLTFLoader, from the file it was dropped as', () => {
    const code = snippetOf(input({ asset: 'robot/scene.gltf' }))
    expect(code).toContain("import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'")
    expect(code).toContain("await new GLTFLoader().loadAsync('/robot/scene.gltf')")
    expect(code).not.toContain('FBXLoader')
  })

  it('loads an FBX with FBXLoader, and bakes the clips it carries', () => {
    const code = snippetOf(input({ asset: 'Samba Dancing.fbx', format: 'fbx', choices: { mergeVertices: false } }))
    expect(code).toContain("import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'")
    expect(code).toContain("const root = await new FBXLoader().loadAsync('/Samba Dancing.fbx')")
    expect(code).toContain('const clips = root.animations\n')
    expect(code).not.toContain('GLTFLoader')
  })

  it('merges the vertices only for an FBX with the toggle on', () => {
    const fbx = (mergeVertices: boolean) =>
      snippetOf(input({ asset: 'Samba Dancing.fbx', format: 'fbx', choices: { mergeVertices } }))
    expect(fbx(true)).toContain('mergeVertices(o.geometry)')
    expect(fbx(true)).toContain("import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'")
    expect(fbx(false)).not.toContain('mergeVertices')
    expect(snippetOf(input())).not.toContain('mergeVertices')
  })

  it("imports the decode path of the page's own renderer", () => {
    const webgl = snippetOf(input({ renderer: 'webgl' }))
    const webgpu = snippetOf(input({ renderer: 'webgpu' }))
    expect(webgl).toContain("import { createVATMesh } from 'three-vat/webgl'")
    expect(webgl).not.toContain('three-vat/tsl')
    expect(webgpu).toContain("import { createVATMesh } from 'three-vat/tsl'")
    expect(webgpu).not.toContain('three-vat/webgl')
  })

  it("links to the worker example of the page's own renderer, rather than inlining a worker", () => {
    expect(snippetOf(input({ renderer: 'webgl' }))).toContain(`${GALLERY_URL}webgl_worker.html`)
    expect(snippetOf(input({ renderer: 'webgpu' }))).toContain(`${GALLERY_URL}webgpu_worker.html`)
    expect(snippetOf(input())).not.toMatch(/new Worker|serveVATBakes/)
  })

  it('quotes a name however it is spelled', () => {
    const name = 'it\'s a \\ "quote"\n'
    const code = snippetOf(
      input({
        asset: `${name}.glb`,
        clips: [
          { name, checked: true },
          { name: 'x', checked: false },
        ],
      }),
    )
    expect(code).toContain(String.raw`'/it\'s a \\ "quote"\n.glb'`)
    expect(code).toContain(String.raw`['it\'s a \\ "quote"\n']`)
  })
})
