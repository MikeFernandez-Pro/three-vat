// Confirm the registry actually holds the version in package.json.
//
// `three-vat` 0.2.0 shipped a CHANGELOG entry and a README badge claiming it was
// "published on npm" while the registry only ever received 0.1.0 — the release
// step was skipped and nothing caught it. Run this after every publish.
//
// npm returns from `publish` before the new version is readable ("Your package
// is being processed and may take a few minutes to become available"), so a
// single immediate query reports a false failure on a perfectly good release.
// Poll until it shows up, and only then call it landed.

import { readFileSync } from 'node:fs'

const { name, version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const TIMEOUT_MS = 5 * 60_000
const INTERVAL_MS = 15_000
const deadline = Date.now() + TIMEOUT_MS

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Ask the registry directly, defeating both the npm cache and any CDN cache. */
async function publishedVersions() {
  const response = await fetch(`https://registry.npmjs.org/${name}?t=${Date.now()}`, {
    cache: 'no-store',
    headers: { 'cache-control': 'no-cache' },
  })
  if (!response.ok) throw new Error(`registry lookup failed: ${response.status} ${response.statusText}`)
  return Object.keys((await response.json()).versions ?? {})
}

let versions = []
for (let attempt = 1; ; attempt++) {
  try {
    versions = await publishedVersions()
    if (versions.includes(version)) {
      console.log(`✓ ${name}@${version} is live on the registry`)
      process.exit(0)
    }
  } catch (error) {
    console.error(`  attempt ${attempt}: ${error.message}`)
  }

  if (Date.now() + INTERVAL_MS > deadline) break
  console.log(`  attempt ${attempt}: not visible yet, still propagating — retrying in ${INTERVAL_MS / 1000}s`)
  await sleep(INTERVAL_MS)
}

console.error(`✗ ${name}@${version} did not appear within ${TIMEOUT_MS / 60_000} minutes.`)
console.error(`  published versions: ${versions.join(', ') || '(none)'}`)
console.error('  If `npm publish` printed "+ ' + name + '@' + version + '" it may still land — recheck with')
console.error('  `node scripts/verify-published.mjs` before assuming the release failed.')
process.exit(1)
