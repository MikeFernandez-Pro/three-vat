// Fetch the real-asset test fixtures that are too large to keep in git.
//
// `examples/public/RobotExpressive.glb` is committed because the demo needs it
// at 464 KB. Soldier is 2.1 MB and was only the test suite's, so it is fetched
// on demand instead and `src/bake.integration.test.ts` skips its describe block
// when the file is absent — `pnpm test` stays green on a fresh clone with no
// network. The Soldier example (ADR-0019) has since committed its own copy at
// `examples/public/Soldier.glb`, the same pinned bytes; the suite and the
// parity gate still read this one (docs/test-assets.md). Michelle (3.1 MB) is
// the normal-mapped skinned case (#78) and is only ever the suite's. The two
// FBX files (#99) are the suite's too: Samba Dancing is the common Mixamo
// export, RotationTest the pre- and post-rotation transform only FBX carries.
//
// Pinned to a three.js tag, not `dev`: the tests assert exact vertex counts, so
// the bytes have to be the same bytes every time. The digest is what actually
// enforces that; the tag alone is a mutable pointer.

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const THREE_TAG = 'r186'

const ASSETS = [
  {
    path: 'test-assets/Soldier.glb',
    url: `https://raw.githubusercontent.com/mrdoob/three.js/${THREE_TAG}/examples/models/gltf/Soldier.glb`,
    sha256: 'dfb230fc1f942f259dd00281a1186953ad602fc5d69067ce63e24b2aa439736b',
  },
  {
    path: 'test-assets/Michelle.glb',
    url: `https://raw.githubusercontent.com/mrdoob/three.js/${THREE_TAG}/examples/models/gltf/Michelle.glb`,
    sha256: '7a87e15a99ccbc5e5877be66e1e4ecae0a581adcafa0cce1a5569f49909e968e',
  },
  {
    path: 'test-assets/Samba Dancing.fbx',
    url: `https://raw.githubusercontent.com/mrdoob/three.js/${THREE_TAG}/examples/models/fbx/Samba%20Dancing.fbx`,
    sha256: 'b9003ee562c87bf03051c3a502411b0808d3513f1d74a2011f7530d9f067069f',
  },
  {
    path: 'test-assets/RotationTest.fbx',
    url: `https://raw.githubusercontent.com/mrdoob/three.js/${THREE_TAG}/examples/models/fbx/RotationTest.fbx`,
    sha256: 'ef6783a6a39b74ef46d23160e3beec4047408c49d270d1bb8db2745db0832695',
  },
]

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** Already downloaded, and still the bytes we pinned? Then leave it alone. */
function isCurrent(asset) {
  try {
    return digest(readFileSync(asset.path)) === asset.sha256
  } catch {
    return false
  }
}

for (const asset of ASSETS) {
  if (isCurrent(asset)) {
    console.log(`✓ ${asset.path} (already present)`)
    continue
  }

  console.log(`↓ ${asset.path} ← ${asset.url}`)
  const response = await fetch(asset.url)
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.statusText} for ${asset.url}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())

  // A wrong digest means the pinned tag moved or the download is damaged.
  // Either way, writing the file would hand the suite an asset it never
  // agreed to — and the vertex-count assertions would fail far from the cause.
  const actual = digest(bytes)
  if (actual !== asset.sha256) {
    throw new Error(
      `${asset.path}: sha256 mismatch\n  expected ${asset.sha256}\n  received ${actual}\n` +
        `The pinned three.js tag (${THREE_TAG}) may have moved. Verify the asset, then update ASSETS.`,
    )
  }

  mkdirSync(dirname(asset.path), { recursive: true })
  writeFileSync(asset.path, bytes)
  console.log(`✓ ${asset.path} (${(bytes.byteLength / 1048576).toFixed(1)} MB)`)
}
