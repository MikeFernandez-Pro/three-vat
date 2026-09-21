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
// whatever the npm account is enrolled in. Both shapes are handled below; the
// flag each one needs is added here rather than in a shell fragment, so it
// works the same on every platform.
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

// The second factor, and the reason this spawns `npm` rather than `pnpm`.
//
// An account on **authenticator** 2FA has a code to pass, and `--otp` is how it
// is passed. An account on a **passkey** — WebAuthn, a security key or the
// platform authenticator — has no code at all: npm hands the browser a
// challenge and waits for it to be approved. `pnpm publish` cannot do that. It
// knows only how to ask for a six-digit code, so on a passkey account it runs
// the whole of `prepublishOnly` and then dies at `npm error code EOTP` with no
// way forward — which is exactly how the 2.0.0 release went before this changed.
//
// `npm publish` runs `prepublishOnly` identically and builds the identical
// tarball (`files` is `dist` alone), so nothing about *what* ships depends on
// which client sends it. `--auth-type=web` is explicit rather than left to the
// machine's `npm config`, and it costs a token-authenticated release nothing: a
// granular or automation token bypasses 2FA outright, so the web flow is never
// reached and the flag is inert.
const factor = code ? [`--otp=${code}`] : ['--auth-type=web']

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
