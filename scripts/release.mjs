// Publish, then prove it landed. `node scripts/release.mjs`.
//
// It is a script rather than a package.json entry because `pnpm run` is the
// repository's front door and a release is not something a newcomer types (#25):
// the person-facing list is `dev`, `test`, `build` and `typecheck`, and
// everything a release needs lives here or in `release/`, with
// docs/releasing.md as the index.
//
// The two steps are one command on purpose. `three-vat` 0.2.0 shipped a
// CHANGELOG entry and a README badge for a version the registry never received,
// because publishing and confirming were two things to remember and only the
// first got done.
//
// Authentication is whatever `~/.npmrc` holds, and the second factor is
// whatever the npm account is enrolled in. Which flags that needs is
// `publishAuth`, decided next door so it can be pinned by tests; this file is
// the part that spawns, which no test can run.
import { spawnSync } from 'node:child_process'
import { loginProblem, publishAuth } from './publish-args.mjs'

let factor
try {
  factor = publishAuth(process.env.NPM_OTP)
} catch (problem) {
  console.error(problem instanceof Error ? problem.message : String(problem))
  process.exit(1)
}

// The login first: `prepublishOnly` runs every suite before npm reaches the
// registry, and a lapsed login found there is minutes late (5.0.1). Same
// shell rule as the publish below, for the same reason.
const whoami = spawnSync('npm', ['whoami'], {
  encoding: 'utf8',
  stdio: ['ignore', 'ignore', 'pipe'],
  shell: process.platform === 'win32',
})
const problem = loginProblem({ status: whoami.error ? null : whoami.status, stderr: whoami.stderr ?? '' })
if (problem) {
  console.error(problem)
  process.exit(1)
}

// `npm`, not `pnpm`, and that is the whole of why this file changed after
// 2.0.0. `pnpm publish` can only ask for a six-digit code, so an account on a
// passkey ran the entirety of `prepublishOnly`, reached the registry, and died
// at `EOTP` with nothing left to try. `npm publish` runs the same lifecycle
// script and builds the same tarball — `files` is `dist` alone — so which
// client sends it changes nothing about what ships.
//
// `shell` on Windows because npm is a `.cmd` there, which node will not spawn
// directly; the OTP is the only interpolated argument, and it is checked above.
const { status, error } = spawnSync('npm', ['publish', ...factor], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (error) throw error
if (status !== 0) process.exit(status ?? 1)

// In-process, not a second spawn: it polls the registry and sets the exit code,
// which is this script's exit code too.
await import('./verify-published.mjs')
