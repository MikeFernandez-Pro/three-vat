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
// Authentication is whatever `~/.npmrc` holds. Set `NPM_OTP` when the account is
// on authenticator-based 2FA for publish and the flag is added for you — done
// here rather than in a shell fragment, so it works the same on every platform.
import { spawnSync } from 'node:child_process'

// Checked rather than quoted. The shell fragment this replaced quoted the value
// (`--otp="$NPM_OTP"`), and on Windows this runs through a shell too — so a
// value with a space or a metacharacter in it would be the shell's problem, not
// npm's. An OTP is six digits; anything else is a mistake worth naming here
// rather than a string worth escaping.
const code = process.env.NPM_OTP
if (code !== undefined && !/^[0-9]{6,8}$/.test(code)) {
  console.error(`NPM_OTP is not an authenticator code: ${JSON.stringify(code)}`)
  process.exit(1)
}

const otp = code ? [`--otp=${code}`] : []

// `pnpm publish` runs `prepublishOnly` — typecheck, every suite, build — first.
// `shell` on Windows because pnpm is a `.cmd` there, which node will not spawn
// directly; the OTP is the only interpolated argument, and it is checked above.
const { status, error } = spawnSync('pnpm', ['publish', ...otp], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (error) throw error
if (status !== 0) process.exit(status ?? 1)

// In-process, not a second spawn: it polls the registry and sets the exit code,
// which is this script's exit code too.
await import('./verify-published.mjs')
