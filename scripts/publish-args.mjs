// What `npm publish` is handed, decided apart from the spawning that uses it.
//
// Split for the reason the hero capture and the parity gate are split: the part
// that reaches the network cannot run in CI, and the part that decides what it
// will do is pure and can. A release is the least-exercised command in this
// repository — it runs once per version, by hand, and the run that would find a
// bug in it is the run that needed it to work. 2.0.0 found one that way.

/** The flag that drives npm's browser challenge, for an account on a passkey. */
export const WEB_AUTH = '--auth-type=web'

/**
 * The npm flags carrying the account's second factor, from `NPM_OTP`.
 *
 * Three shapes reach the registry and each needs something different:
 *
 * - **A granular or automation token** bypasses 2FA before npm asks, so the web
 *   flag is inert and passing it costs nothing.
 * - **A passkey** — WebAuthn, a security key, the platform authenticator — has
 *   no code to pass at all. It needs {@link WEB_AUTH} and a human at a browser.
 * - **An authenticator app** has a code, and `--otp` is how it travels.
 *
 * The two flags are never sent together: `--otp` answers the challenge that
 * `--auth-type=web` exists to open.
 *
 * @param {string | undefined} code `process.env.NPM_OTP`.
 * @returns {string[]} flags for `npm publish`.
 * @throws {Error} if `NPM_OTP` is set to something that is not a code. Checked
 * rather than quoted: on Windows the publish runs through a shell, so a value
 * with a metacharacter in it would be the shell's problem and not npm's.
 */
export function publishAuth(code) {
  if (code === undefined) return [WEB_AUTH]

  // An empty `NPM_OTP` is a mistake worth naming, not an absent one worth
  // guessing at. A CI job that exports the variable unset has not chosen the
  // passkey flow — it has lost the code it meant to pass, and falling through
  // to a browser challenge nobody is watching would hang the release instead.
  if (!/^[0-9]{6,8}$/.test(code)) {
    throw new Error(`NPM_OTP is not an authenticator code: ${JSON.stringify(code)}`)
  }

  return [`--otp=${code}`]
}

/**
 * What is wrong with npm's login, from what `npm whoami` did, or `null` if
 * nothing is.
 *
 * Asked before the publish because `prepublishOnly` runs every suite before npm
 * reaches the registry: 5.0.1's publish found the login had lapsed since the
 * last release only after all of them had passed. A passkey account's session
 * does not outlive the gap between two releases, so this is the usual case,
 * not a rare one.
 *
 * @param {{ status: number | null, stderr: string }} whoami how `npm whoami`
 * exited; `null` if it never ran.
 * @returns {string | null} what to tell the person releasing.
 */
export function loginProblem({ status, stderr }) {
  if (status === 0) return null
  if (/\bE401\b|401 Unauthorized|ENEEDAUTH/.test(stderr)) {
    return `npm is not logged in, or the login has expired. Run \`npm login ${WEB_AUTH}\`, approve it in the browser, then release again.`
  }
  return `\`npm whoami\` failed, so the release stopped before publishing:\n${stderr.trim() || `exit status ${status}`}`
}
