#!/usr/bin/env node
// The package's `bin` (ADR-0034): Node's own file system and streams handed to
// the command, which is all of it, and the `FileReader` three's exporter reads
// its own output back through, which Node lacks. Everything else is
// src/cli.ts, held there in process by tests that hand it a file table instead.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import process, { argv, cwd, stderr, stdout } from 'node:process'
import { EXIT_CRASH, runCommand } from './cli.js'
import { installFileReader } from './file-reader.js'

installFileReader()

runCommand(argv.slice(2), {
  cwd: cwd(),
  readFile: (path) => readFileSync(path),
  exists: existsSync,
  writeFile: (path, bytes) => {
    // `--out out/robot.vat.glb` makes `out/` rather than failing on it.
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
  },
  stdout: (text) => void stdout.write(text),
  stderr: (text) => void stderr.write(text),
}).then(
  (code) => {
    // Set rather than `exit()`ed, so a report piped to a slow reader is flushed first.
    process.exitCode = code
  },
  (error: unknown) => {
    // A bug in the command, not a verdict on the asset: its own code, so CI
    // never reads a crash as a refusal.
    stderr.write(`three-vat: the command crashed; please report it
${(error as Error)?.stack ?? String(error)}
`)
    process.exitCode = EXIT_CRASH
  },
)
