import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import * as bake_ from './bake.js'
import { EXIT_OK, EXIT_REFUSED, EXIT_USAGE, runCommand } from './cli.js'
import type { CommandIO } from './cli.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { assetMissing, expectSameVAT, installNodeFileGlobals, loadVATBytes } from './test-utils.js'

// The command, in process (#112, ADR-0034): argv in, text and an exit code out,
// every file read through a table in memory. No child process is spawned, so
// what is held here is what the `bin` shim hands straight through.
const ROBOT = 'examples/public/RobotExpressive.glb'
const SOLDIER = 'test-assets/Soldier.glb'
/** Meshopt geometry under KTX2 textures, and a face whose clip animates its morphs. */
const FACECAP = 'test-assets/facecap.glb'
/** Draco geometry. */
const DUCK = 'test-assets/duck.glb'
const SAMBA = 'test-assets/Samba Dancing.fbx'
const ROTATION = 'test-assets/RotationTest.fbx'

/** facecap's one morph-animated clip, at a rate that keeps its vertex bake quick. */
const FACE_CLIP = 'Key|Take 001|BaseLayer'
const FACE_FAST = ['--clips', FACE_CLIP, '--fps', '5']

/** An in-memory file system under `/work`, the two streams, and a stopped clock. */
function memoryIO(files: Record<string, Uint8Array | string>) {
  const out: string[] = []
  const err: string[] = []
  const table = new Map(
    Object.entries(files).map(([path, body]) => [
      path,
      typeof body === 'string' ? new TextEncoder().encode(body) : body,
    ]),
  )
  const io: CommandIO = {
    cwd: '/work',
    readFile(path) {
      const body = table.get(path)
      if (body === undefined) throw new Error(`ENOENT: no such file, open '${path}'`)
      return body
    },
    exists: (path) => table.has(path),
    writeFile: (path, bytes) => void table.set(path, bytes),
    stdout: (text) => void out.push(text),
    stderr: (text) => void err.push(text),
    now: () => 0,
  }
  return { io, stdout: () => out.join(''), stderr: () => err.join(''), file: (path: string) => table.get(path) }
}

/** Run the command over one asset copied to `/work/<name>`, plus any other files. */
async function bake(asset: string, name: string, flags: string[] = [], files: Record<string, string> = {}) {
  const { io, stdout, stderr } = memoryIO({ [`/work/${name}`]: readFileSync(asset), ...files })
  const code = await runCommand(['bake', name, ...flags], io)
  return { code, stdout: stdout(), stderr: stderr() }
}

/** The report's line that starts with `prefix`. */
const line = (report: string, prefix: string) => report.split('\n').find((l) => l.startsWith(prefix))

describe.skipIf(assetMissing(ROBOT))('three-vat bake: the report', () => {
  it('reports a rig-encoded bake, line for line, and exits 0', async () => {
    const { code, stdout, stderr } = await bake(ROBOT, 'robot.glb', ['--clips', 'Idle,Walking,Wave'])
    expect(stderr).toBe('')
    expect(code).toBe(EXIT_OK)
    // Pinned whole: the report is meant to be diffed, so a change to it is a
    // change a reviewer should see here first.
    expect(stdout).toBe(
      [
        'three-vat bake robot.glb',
        'config: none',
        'encoding: rig, 58 slots',
        'clips: 3, 184 frames',
        '  Idle: 100 frames at 30 fps, repeat forever, clamp, speed 1',
        '  Walking: 29 frames at 30.26 fps, repeat forever, clamp, speed 1',
        '  Wave: 55 frames at 30 fps, repeat forever, clamp, speed 1',
        'textures:',
        '  rig: 116 x 185 RGBA32F, 343360 bytes',
        '  total: 343360 bytes',
        'vertices: 7214 as loaded, 7214 merged',
        'materials: 3',
        'bake time: 0 ms',
        '',
      ].join('\n'),
    )
  })

  it('reports a vertex-encoded bake: both layers, with their dimensions and bytes', async () => {
    const { code, stdout } = await bake(ROBOT, 'robot.glb', ['--encoding', 'delta', '--clips', 'Idle'])
    expect(code).toBe(EXIT_OK)
    expect(line(stdout, 'encoding:')).toBe('encoding: delta')
    expect(line(stdout, 'fallback:')).toBeUndefined()
    expect(stdout).toContain(
      [
        'textures:',
        '  position: 7214 x 100 RGBA16F, 5771200 bytes',
        '  normal: 7214 x 100 RG8, 1442800 bytes',
        '  total: 7214000 bytes',
      ].join('\n'),
    )
  })

  it('puts the bake time on a line of its own, the last', async () => {
    const { io, stdout } = memoryIO({ '/work/robot.glb': readFileSync(ROBOT) })
    let t = 0
    io.now = () => (t += 1234.4)
    await runCommand(['bake', 'robot.glb', '--clips', 'Idle'], io)
    const lines = stdout().trimEnd().split('\n')
    expect(lines[lines.length - 1]).toBe('bake time: 1234 ms')
    expect(lines.filter((l) => l.includes('ms'))).toHaveLength(1)
  })

  it('prints a help text on --help, and exits 0', async () => {
    const { io, stdout } = memoryIO({})
    expect(await runCommand(['--help'], io)).toBe(EXIT_OK)
    expect(stdout()).toContain('usage: three-vat bake')
  })
})

describe.skipIf(assetMissing(FACECAP))('three-vat bake: a fallback', () => {
  it('reports it, with the reason, and still exits 0 — meshopt decoded and KTX2 left undecoded', async () => {
    const { code, stdout, stderr } = await bake(FACECAP, 'face.glb', FACE_FAST)
    expect(stderr).toBe('')
    expect(code).toBe(EXIT_OK)
    expect(line(stdout, 'encoding:')).toBe('encoding: delta, fallen back from rig')
    expect(line(stdout, 'fallback:')).toMatch(
      /^fallback: three-vat: the rig encoding cannot bake this subtree: clip "Key\|Take 001\|BaseLayer" animates morph target/,
    )
    expect(line(stdout, 'vertices:')).toBe('vertices: 4368 as loaded, 4368 merged')
  })

  it('fails under --encoding rig, in the words the fallback kept: the bake’s own', async () => {
    const fallback = line((await bake(FACECAP, 'face.glb', FACE_FAST)).stdout, 'fallback: ')!
    const { code, stdout, stderr } = await bake(FACECAP, 'face.glb', [...FACE_FAST, '--encoding', 'rig'])
    expect(code).toBe(EXIT_REFUSED)
    expect(stdout).toBe('')
    expect(stderr).toBe(`${fallback.slice('fallback: '.length)}\n`)
  })

  it('fails when both encodings refuse, naming both', async () => {
    const { code, stdout, stderr } = await bake(FACECAP, 'face.glb', [...FACE_FAST, '--max-texture-size', '8'])
    expect(code).toBe(EXIT_REFUSED)
    expect(stdout).toBe('')
    expect(stderr).toMatch(/^three-vat: neither encoding can bake this subtree\. The vertex encoding: totalFrames \d+ exceeds maxTextureSize 8/)
    expect(stderr).toContain('The rig encoding, tried first: the rig encoding cannot bake this subtree')
  })
})

describe.skipIf(assetMissing(ROBOT))('three-vat bake: the flags', () => {
  it('--clips bakes those, in that order, and --fps samples them at that rate', async () => {
    const { stdout } = await bake(ROBOT, 'robot.glb', ['--clips', 'Wave,Idle', '--fps', '15'])
    expect(line(stdout, 'clips:')).toBe('clips: 2, 78 frames')
    expect(line(stdout, '  Wave:')).toBe('  Wave: 28 frames at 15.27 fps, repeat forever, clamp, speed 1')
    expect(line(stdout, '  Idle:')).toBe('  Idle: 50 frames at 15 fps, repeat forever, clamp, speed 1')
    expect(stdout.indexOf('  Wave:')).toBeLessThan(stdout.indexOf('  Idle:'))
  })

  it('--clips defaults to every clip in the file', async () => {
    expect(line((await bake(ROBOT, 'robot.glb')).stdout, 'clips:')).toBe('clips: 14, 585 frames')
  })

  it('--max-texture-size spans a vertex-encoded frame across rows (ADR-0030)', async () => {
    const { stdout } = await bake(ROBOT, 'robot.glb', ['--encoding=delta', '--clips=Idle', '--max-texture-size=4096'])
    expect(line(stdout, 'encoding:')).toBe('encoding: delta, 2 rows per frame')
    expect(line(stdout, '  position:')).toBe('  position: 3607 x 200 RGBA16F, 5771200 bytes')
  })

  it('--no-normals drops the normal layer', async () => {
    const { stdout } = await bake(ROBOT, 'robot.glb', ['--encoding', 'delta', '--clips', 'Idle', '--no-normals'])
    expect(line(stdout, '  normal:')).toBeUndefined()
    expect(line(stdout, '  total:')).toBe('  total: 5771200 bytes')
  })

  it('--merge-flat-materials collapses the robot’s three flat materials into one', async () => {
    const { stdout } = await bake(ROBOT, 'robot.glb', ['--clips', 'Idle', '--merge-flat-materials'])
    expect(line(stdout, 'materials:')).toBe('materials: 1')
  })

  it('--max-bytes passes a bake inside it, and fails one over it after reporting', async () => {
    const inside = await bake(ROBOT, 'robot.glb', ['--clips', 'Idle', '--max-bytes', '187456'])
    expect(inside.code).toBe(EXIT_OK)

    const over = await bake(ROBOT, 'robot.glb', ['--clips', 'Idle', '--max-bytes', '187455'])
    expect(over.code).toBe(EXIT_REFUSED)
    expect(line(over.stdout, '  total:')).toBe('  total: 187456 bytes')
    expect(over.stderr).toBe("three-vat: the VAT's textures are 187456 bytes, over the 187455 --max-bytes allows\n")
  })

  it.each([
    [['--frobnicate'], 'three-vat: unknown flag --frobnicate'],
    [['--encoding', 'vertex'], 'three-vat: --encoding takes auto, rig, delta, not "vertex"'],
    [['--fps', 'fast'], 'three-vat: --fps takes a positive number, not "fast"'],
    [['--max-bytes', '1.5'], 'three-vat: --max-bytes takes a positive integer, not "1.5"'],
    [['--no-normals=false'], 'three-vat: --no-normals takes no value'],
    [['--fps'], 'three-vat: --fps takes a value'],
    [['other.glb'], 'three-vat: one input at a time: "robot.glb", then "other.glb"'],
  ])('refuses %j by name, with the usage, and exits 2', async (flags, message) => {
    const { code, stdout, stderr } = await bake(ROBOT, 'robot.glb', flags)
    expect(code).toBe(EXIT_USAGE)
    expect(stdout).toBe('')
    expect(stderr.startsWith(`${message}\n`)).toBe(true)
    expect(stderr).toContain('usage: three-vat bake')
  })

  it('refuses a clip name the file does not have, naming the ones it does', async () => {
    const { code, stderr } = await bake(ROBOT, 'robot.glb', ['--clips', 'Idle,Idel'])
    expect(code).toBe(EXIT_USAGE)
    expect(stderr).toMatch(/^three-vat: no clip named "Idel"; the file has "Dance", "Death", "Idle",/)
  })

  it('takes --help only where a flag could stand', async () => {
    const asked = memoryIO({})
    expect(await runCommand(['bake', 'robot.glb', '--help'], asked.io)).toBe(EXIT_OK)
    expect(asked.stdout()).toContain('usage: three-vat bake')

    // A clip named -h is a clip.
    const { code, stderr } = await bake(ROBOT, 'robot.glb', ['--clips', '-h'])
    expect(code).toBe(EXIT_USAGE)
    expect(stderr).toMatch(/^three-vat: no clip named "-h"/)
  })

  it('lets a bug in the bake crash rather than pass for a refusal', async () => {
    const spy = vi.spyOn(bake_, 'bakeVAT').mockImplementation(() => {
      throw new TypeError('x is undefined')
    })
    try {
      const { io } = memoryIO({ '/work/robot.glb': readFileSync(ROBOT) })
      await expect(runCommand(['bake', 'robot.glb', '--clips', 'Idle'], io)).rejects.toThrow(TypeError)
    } finally {
      spy.mockRestore()
    }
  })

  it('refuses no command, or another one', async () => {
    const { io, stderr } = memoryIO({})
    expect(await runCommand([], io)).toBe(EXIT_USAGE)
    expect(await runCommand(['cook', 'robot.glb'], io)).toBe(EXIT_USAGE)
    expect(stderr()).toContain('three-vat: unknown command "cook"; the one command is "bake"')
  })
})

describe.skipIf(assetMissing(ROBOT))('three-vat bake --out: write mode', () => {
  installNodeFileGlobals()

  it('writes a baked file loadVAT loads as a direct bake, and reports its path and size', async () => {
    const { io, stdout, stderr, file } = memoryIO({ '/work/robot.glb': readFileSync(ROBOT) })
    const flags = ['--encoding', 'delta', '--clips', 'Idle', '--fps', '10']
    expect(await runCommand(['bake', 'robot.glb', ...flags, '--out', 'out/robot.vat.glb'], io)).toBe(EXIT_OK)
    expect(stderr()).toBe('')

    // The two seams meet here: the command's bytes, read back by loadVAT, are
    // the VAT a page baking the same asset gets.
    const written = file('/work/out/robot.vat.glb')!
    expect(line(stdout(), 'written:')).toBe(`written: out/robot.vat.glb, ${written.byteLength} bytes`)
    const lines = stdout().trimEnd().split('\n')
    expect(lines[lines.length - 1]).toMatch(/^bake time: /)

    const gltf = await new GLTFLoader().parseAsync(new Uint8Array(readFileSync(ROBOT)).buffer, '')
    const direct = bake_.bakeVAT(gltf.scene, gltf.animations.filter((c) => c.name === 'Idle'), { encoding: 'delta', fps: 10 })
    expectSameVAT(await loadVATBytes(written), direct, { materials: 'value' })
  }, 60_000)

  it('writes nothing in report mode, and nothing over --max-bytes', async () => {
    const { io, file } = memoryIO({ '/work/robot.glb': readFileSync(ROBOT) })
    expect(await runCommand(['bake', 'robot.glb', '--encoding', 'delta', '--clips', 'Idle'], io)).toBe(EXIT_OK)
    const over = ['--encoding', 'delta', '--clips', 'Idle', '--max-bytes', '1', '--out', 'robot.vat.glb']
    expect(await runCommand(['bake', 'robot.glb', ...over], io)).toBe(EXIT_REFUSED)
    expect(file('/work/robot.vat.glb')).toBeUndefined()
  })

  it('writes the encoding the default bake chose: the rig, where the asset allows it', async () => {
    const { io, stdout, stderr, file } = memoryIO({ '/work/robot.glb': readFileSync(ROBOT) })
    const flags = ['--clips', 'Idle', '--fps', '10', '--out', 'robot.vat.glb']
    expect(await runCommand(['bake', 'robot.glb', ...flags], io)).toBe(EXIT_OK)
    expect(stderr()).toBe('')
    expect(line(stdout(), 'encoding:')).toBe('encoding: rig, 58 slots')

    const written = file('/work/robot.vat.glb')!
    expect(line(stdout(), 'written:')).toBe(`written: robot.vat.glb, ${written.byteLength} bytes`)
    const gltf = await new GLTFLoader().parseAsync(new Uint8Array(readFileSync(ROBOT)).buffer, '')
    const direct = bake_.bakeVAT(gltf.scene, gltf.animations.filter((c) => c.name === 'Idle'), { fps: 10 })
    expectSameVAT(await loadVATBytes(written), direct, { materials: 'value' })
  }, 60_000)

  it('refuses a path it cannot write, and exits 2', async () => {
    const { io, stderr } = memoryIO({ '/work/robot.glb': readFileSync(ROBOT) })
    io.writeFile = () => {
      throw new Error('EACCES')
    }
    const flags = ['--encoding', 'delta', '--clips', 'Idle', '--fps', '5', '--out', 'robot.vat.glb']
    expect(await runCommand(['bake', 'robot.glb', ...flags], io)).toBe(EXIT_USAGE)
    expect(stderr()).toBe('three-vat: cannot write robot.vat.glb: EACCES\n')
  })
})

describe('three-vat bake: the input', () => {
  it('finds the config beside an input at the root, and reads a UNC share', async () => {
    const read: string[] = []
    const { io } = memoryIO({})
    io.exists = (path) => {
      read.push(`exists ${path}`)
      return false
    }
    io.readFile = (path) => {
      read.push(`read ${path}`)
      throw new Error('ENOENT')
    }
    await runCommand(['bake', '/robot.glb'], io)
    await runCommand(['bake', '\\\\server\\share\\robot.glb'], io)
    expect(read).toEqual([
      'exists /vat.config.json',
      'read /robot.glb',
      'exists //server/share/vat.config.json',
      'read //server/share/robot.glb',
    ])
  })


  it('refuses a file it cannot read', async () => {
    const { io, stderr } = memoryIO({})
    expect(await runCommand(['bake', 'missing.glb'], io)).toBe(EXIT_USAGE)
    expect(stderr()).toBe("three-vat: cannot read missing.glb: ENOENT: no such file, open '/work/missing.glb'\n")
  })

  it('refuses a format it does not support, by its extension', async () => {
    const { io, stderr } = memoryIO({ '/work/model.obj': 'v 0 0 0' })
    expect(await runCommand(['bake', 'model.obj'], io)).toBe(EXIT_USAGE)
    expect(stderr()).toBe('three-vat: model.obj is not a supported format; the command bakes .glb, .gltf and .fbx\n')
  })

  it('refuses a .glb that is not one', async () => {
    const { io, stderr } = memoryIO({ '/work/model.glb': 'not a model' })
    expect(await runCommand(['bake', 'model.glb'], io)).toBe(EXIT_USAGE)
    expect(stderr()).toMatch(/^three-vat: cannot read model\.glb as glTF: /)
  })

  it.skipIf(assetMissing(DUCK))('refuses Draco with the gltf-transform command that decodes it', async () => {
    const { code, stdout, stderr } = await bake(DUCK, 'duck.glb')
    expect(code).toBe(EXIT_USAGE)
    expect(stdout).toBe('')
    expect(stderr).toBe(
      'three-vat: duck.glb is Draco-compressed (KHR_draco_mesh_compression), which the command cannot decode ' +
        'in Node. Decode it first, then bake the result:\n\n' +
        '  npx @gltf-transform/cli copy duck.glb duck.decoded.glb\n\n',
    )
  })

  it.skipIf(assetMissing(ROBOT))('reads a .gltf and the external buffer it names', async () => {
    // RobotExpressive's own GLB, split into the JSON and the .bin it indexes.
    const glb = readFileSync(ROBOT)
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
    const jsonLength = view.getUint32(12, true)
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)))
    const binStart = 20 + jsonLength + 8
    json.buffers[0].uri = 'robot%20data.bin'
    const { io, stdout, stderr } = memoryIO({
      '/work/models/robot.gltf': JSON.stringify(json),
      '/work/models/robot data.bin': glb.slice(binStart, binStart + view.getUint32(20 + jsonLength, true)),
    })

    const code = await runCommand(['bake', 'models/robot.gltf', '--clips', 'Idle'], io)
    expect(stderr()).toBe('')
    expect(code).toBe(EXIT_OK)
    expect(line(stdout(), 'encoding:')).toBe('encoding: rig, 58 slots')
  })
})

describe.skipIf(assetMissing(ROBOT))('three-vat bake: vat.config.json', () => {
  const config = (entries: unknown) => JSON.stringify(entries)

  it('is found beside the input, and its clip defaults land in the report — a negative speed included', async () => {
    const { io, stdout, stderr } = memoryIO({
      '/work/assets/robot.glb': readFileSync(ROBOT),
      '/work/assets/vat.config.json': config({
        'robot.glb': {
          clips: ['Idle', 'Death', 'Wave'],
          fps: 15,
          clipDefaults: {
            Death: { loopMode: 'once', endMode: 'rewind', speed: -1 },
            Idle: { loopMode: 'pingpong', repetitions: 3 },
            Wave: { speed: 0.5 },
          },
        },
      }),
    })
    expect(await runCommand(['bake', 'assets/robot.glb'], io)).toBe(EXIT_OK)
    expect(stderr()).toBe('')
    const report = stdout()
    expect(line(report, 'config:')).toBe('config: /work/assets/vat.config.json')
    expect(line(report, '  Idle:')).toBe('  Idle: 50 frames at 15 fps, pingpong x3, clamp, speed 1')
    expect(line(report, '  Death:')).toBe('  Death: 14 frames at 14.61 fps, once, rewind, speed -1')
    expect(line(report, '  Wave:')).toBe('  Wave: 28 frames at 15.27 fps, repeat forever, clamp, speed 0.5')
  })

  it('is named by --config, with its keys relative to its own folder', async () => {
    const { io, stdout } = memoryIO({
      '/work/assets/robot.glb': readFileSync(ROBOT),
      '/work/config/crowd.json': config({ '../assets/robot.glb': { clips: ['Idle'] } }),
    })
    expect(await runCommand(['bake', 'assets/robot.glb', '--config', 'config/crowd.json'], io)).toBe(EXIT_OK)
    expect(line(stdout(), 'config:')).toBe('config: config/crowd.json')
    expect(line(stdout(), 'clips:')).toBe('clips: 1, 100 frames')
  })

  it('loses to a flag, key by key', async () => {
    const { io, stdout } = memoryIO({
      '/work/robot.glb': readFileSync(ROBOT),
      '/work/vat.config.json': config({ 'robot.glb': { clips: ['Idle'], fps: 10, encoding: 'delta', bakeNormals: false } }),
    })
    expect(await runCommand(['bake', 'robot.glb', '--fps', '15', '--encoding', 'rig'], io)).toBe(EXIT_OK)
    // fps and encoding from the flags; the clip list from the config.
    expect(line(stdout(), 'encoding:')).toBe('encoding: rig, 58 slots')
    expect(line(stdout(), '  Idle:')).toBe('  Idle: 50 frames at 15 fps, repeat forever, clamp, speed 1')
    expect(line(stdout(), 'clips:')).toBe('clips: 1, 50 frames')
  })

  it('applies nothing from an entry for another input', async () => {
    const { io, stdout } = memoryIO({
      '/work/robot.glb': readFileSync(ROBOT),
      '/work/vat.config.json': config({ 'soldier.glb': { clips: ['Walk'] } }),
    })
    expect(await runCommand(['bake', 'robot.glb'], io)).toBe(EXIT_OK)
    expect(line(stdout(), 'clips:')).toBe('clips: 14, 585 frames')
  })

  it('carries --max-bytes as maxBytes', async () => {
    const { io, stderr } = memoryIO({
      '/work/robot.glb': readFileSync(ROBOT),
      '/work/vat.config.json': config({ 'robot.glb': { clips: ['Idle'], maxBytes: 1000 } }),
    })
    expect(await runCommand(['bake', 'robot.glb'], io)).toBe(EXIT_REFUSED)
    expect(stderr()).toBe("three-vat: the VAT's textures are 187456 bytes, over the 1000 --max-bytes allows\n")
  })

  it.each([
    [{ 'robot.glb': { fsp: 30 } }, 'unknown config key "fsp" in "robot.glb"; expected one of fps, clips,'],
    [{ 'robot.glb': { clipDefaults: { Idle: { loop: 'once' } } } }, 'unknown config key "loop" in "robot.glb".clipDefaults.Idle'],
    [{ 'robot.glb': { clipDefaults: { Idel: { speed: 2 } } } }, 'no clip named "Idel"; the file has'],
    [{ 'robot.glb': { clipDefaults: { Idle: { loopMode: 'forever' } } } }, '"robot.glb".clipDefaults.Idle.loopMode takes repeat, once, pingpong'],
    [{ 'robot.glb': { bakeNormals: 'no' } }, '"robot.glb".bakeNormals takes true or false'],
    [{ 'robot.glb': { clips: 'Idle' } }, '"robot.glb".clips takes a list of clip names'],
  ])('refuses %j by name, and exits 2', async (entries, message) => {
    const { io, stdout, stderr } = memoryIO({
      '/work/robot.glb': readFileSync(ROBOT),
      '/work/vat.config.json': config(entries),
    })
    expect(await runCommand(['bake', 'robot.glb'], io)).toBe(EXIT_USAGE)
    expect(stdout()).toBe('')
    expect(stderr().startsWith(`three-vat: ${message}`)).toBe(true)
  })

  it('refuses a config that is not JSON, and never evaluates it', async () => {
    const { io, stderr } = memoryIO({
      '/work/robot.glb': readFileSync(ROBOT),
      '/work/vat.config.json': "export default { 'robot.glb': { fps: 30 } }",
    })
    expect(await runCommand(['bake', 'robot.glb'], io)).toBe(EXIT_USAGE)
    expect(stderr()).toMatch(/^three-vat: the config \/work\/vat\.config\.json is not JSON: /)
  })

  it('refuses a --config it cannot read', async () => {
    const { io, stderr } = memoryIO({ '/work/robot.glb': readFileSync(ROBOT) })
    expect(await runCommand(['bake', 'robot.glb', '--config', 'nope.json'], io)).toBe(EXIT_USAGE)
    expect(stderr()).toMatch(/^three-vat: cannot read the config nope\.json: ENOENT/)
  })
})

// The two supported formats, each through the command (ADR-0031).
describe.skipIf(assetMissing(SOLDIER))('three-vat bake: Soldier (glTF)', () => {
  it('reports the rig encoding, 49 slots', async () => {
    const { code, stdout } = await bake(SOLDIER, 'Soldier.glb')
    expect(code).toBe(EXIT_OK)
    expect(line(stdout, 'encoding:')).toBe('encoding: rig, 49 slots')
    expect(line(stdout, 'clips:')).toBe('clips: 4, 113 frames')
    expect(line(stdout, 'vertices:')).toBe('vertices: 7434 as loaded, 7434 merged')
  })
})

describe.skipIf(assetMissing(SAMBA))('three-vat bake: Samba Dancing (FBX)', () => {
  it('merges the vertices FBXLoader left unindexed, and leaves out the empty Take 001', async () => {
    const { code, stdout } = await bake(SAMBA, 'samba.fbx')
    expect(code).toBe(EXIT_OK)
    expect(line(stdout, 'encoding:')).toBe('encoding: rig, 104 slots')
    expect(line(stdout, 'clips:')).toBe('clips: 1, 546 frames')
    expect(line(stdout, '  mixamo.com:')).toBeDefined()
    expect(line(stdout, 'vertices:')).toBe('vertices: 165960 as loaded, 35440 merged')
  })
})

describe.skipIf(assetMissing(ROTATION))('three-vat bake: RotationTest (FBX)', () => {
  it('reports a single rigid slot', async () => {
    const { code, stdout } = await bake(ROTATION, 'cube.fbx')
    expect(code).toBe(EXIT_OK)
    expect(line(stdout, 'encoding:')).toBe('encoding: rig, 1 slot')
    expect(line(stdout, 'vertices:')).toBe('vertices: 36 as loaded, 24 merged')
  })
})
