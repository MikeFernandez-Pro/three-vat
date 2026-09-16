// Confirm the registry actually holds the version in package.json.
//
// `three-vat` 0.2.0 shipped a CHANGELOG entry and a README badge claiming it was
// "published on npm" while the registry only ever received 0.1.0 — the release
// step was skipped and nothing caught it. Run this after every publish: it asks
// the registry directly (no npm cache) and exits non-zero on a mismatch.

import { readFileSync } from 'node:fs'

const { name, version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const response = await fetch(`https://registry.npmjs.org/${name}`, { cache: 'no-store' })
if (!response.ok) {
  console.error(`✗ registry lookup for ${name} failed: ${response.status} ${response.statusText}`)
  process.exit(1)
}

const packument = await response.json()
const published = Object.keys(packument.versions ?? {})

if (!published.includes(version)) {
  console.error(`✗ ${name}@${version} is NOT on the registry.`)
  console.error(`  published versions: ${published.join(', ') || '(none)'}`)
  console.error('  The publish did not land — do not announce this release.')
  process.exit(1)
}

console.log(`✓ ${name}@${version} is live (dist-tag latest: ${packument['dist-tags']?.latest})`)
