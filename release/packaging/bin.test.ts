// The package's one `bin`, the bake command (ADR-0034, #112).
//
// A bin is three things that have to agree, and nothing but a publish would
// notice them disagree: the `bin` entry names a built file, the build has an
// entry that writes it, and that file ships. The source's first line is the
// fourth, because npm links the file as it is and a bin without its `#!` is a
// script the shell tries to run as its own. That the command stays out of every
// page's bundle is pinned with the rest of the subpath isolation, which walks
// the same graph (src/decode-paths.test.ts).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { root } from '../paths.js'

const pkg = JSON.parse(readFileSync(root('package.json'), 'utf8')) as {
  bin?: Record<string, string>
  files: string[]
}

describe('the bin', () => {
  it('is `three-vat`, and it is the built bin entry', () => {
    expect(pkg.bin).toEqual({ 'three-vat': './dist/bin.js' })
  })

  it('is written by the build, from src/bin.ts', () => {
    expect(readFileSync(root('tsup.config.ts'), 'utf8')).toMatch(/^\s*bin: 'src\/bin\.ts',$/m)
  })

  it('ships: dist is what the package publishes', () => {
    expect(pkg.files).toContain('dist')
  })

  it('starts with the line that makes it runnable', () => {
    expect(readFileSync(root('src/bin.ts'), 'utf8').split(/\r?\n/)[0]).toBe('#!/usr/bin/env node')
  })
})
