// The baked file the file example loads (examples/src/webgl_file.ts) is the
// bake command's output, committed. A committed output goes stale silently:
// the day the format's version moves, `loadVAT` refuses the file and the page
// dies on the deployed site, and the day the bake changes, the page shows a
// bake the library no longer makes. So the command is run here, in process,
// on the same source with the same flags, and its bytes are held to the file's.
// The command is deterministic: the same asset and flags write the same bytes.
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCommand } from '../../src/cli.js'
import { installFileReader } from '../../src/file-reader.js'
import { demo } from '../paths.js'

/** The command that wrote the file, run from `examples/`, as the page's header comment gives it. */
const ARGS = ['bake', 'public/Soldier.glb', '--clips', 'Idle,Walk,Run', '--out', 'public/Soldier.vat.glb']

describe('the file example’s baked file', () => {
  it('is what the bake command writes today', async () => {
    installFileReader()
    const cwd = demo('.')
    const resolve = (path: string) => (isAbsolute(path) ? path : join(cwd, path))
    let written: Uint8Array | undefined
    const err: string[] = []
    const code = await runCommand(ARGS, {
      cwd,
      readFile: (path) => readFileSync(resolve(path)),
      exists: (path) => existsSync(resolve(path)),
      // Held, never written: this checks the file, and does not rewrite it.
      writeFile: (_path, bytes) => void (written = bytes),
      stdout: () => {},
      stderr: (text) => void err.push(text),
    })

    expect(code, err.join('')).toBe(0)
    const committed = new Uint8Array(readFileSync(demo('public/Soldier.vat.glb')))
    expect(
      written && Buffer.from(written).equals(Buffer.from(committed)),
      'examples/public/Soldier.vat.glb is stale: from examples/, run `node ../dist/bin.js ' +
        `${ARGS.join(' ')}\` after \`pnpm build\`, and commit the file`,
    ).toBe(true)
  })
})
