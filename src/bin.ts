#!/usr/bin/env node
// The package's `bin` (ADR-0034): Node's own file system and streams handed to
// the command, which is all of it. Everything else is src/cli.ts, held there in
// process by tests that hand it a file table instead.
import { existsSync, readFileSync } from 'node:fs'
import process, { argv, cwd, stderr, stdout } from 'node:process'
import { EXIT_CRASH, runCommand } from './cli.js'

runCommand(argv.slice(2), {
  cwd: cwd(),
  readFile: (path) => readFileSync(path),
  exists: existsSync,
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
