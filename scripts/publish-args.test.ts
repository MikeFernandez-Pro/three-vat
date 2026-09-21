// The publish command, pinned.
//
// A release runs once per version, by hand, and the run that would catch a bug
// in it is the run that needed it to work. That is not a hypothetical: 2.0.0
// built a correct tarball, reached the registry, and died at `EOTP` because
// `scripts/release.mjs` spawned `pnpm publish`, which can only ask for a
// six-digit code — and the account is on a passkey, which has no code. Every
// automated check in this repository passed while the one command that ships
// the package could not ship it.
//
// So two things are pinned here, both of which only a human running a release
// would otherwise discover:
//
//   1. **Which flags carry the second factor**, for each of the three shapes an
//      npm account can be in. Pure, so it runs in CI beside everything else.
//   2. **That the spawn is `npm`**, read off the script as text. The pure half
//      above can be perfect while the shell around it calls a client that
//      cannot use what it returns, which is exactly what happened.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { WEB_AUTH, publishAuth } from './publish-args.mjs'

const RELEASE = new URL('./release.mjs', import.meta.url)

describe('the second factor a publish is handed', () => {
  it('drives the browser challenge when there is no code to pass', () => {
    // The passkey account, and the default. Also the token account: a granular
    // or automation token bypasses 2FA before npm asks, so the flag is inert
    // rather than wrong, and one branch serves both.
    expect(publishAuth(undefined)).toEqual([WEB_AUTH])
  })

  it('passes an authenticator code as --otp, and nothing else', () => {
    // The two flags answer the same question, so sending both is incoherent:
    // `--otp` already answers the challenge `--auth-type=web` opens.
    const flags = publishAuth('123456')

    expect(flags).toEqual(['--otp=123456'])
    expect(flags).not.toContain(WEB_AUTH)
  })

  it('takes the longer codes npm issues as recovery codes', () => {
    expect(publishAuth('12345678')).toEqual(['--otp=12345678'])
  })

  it('always sends exactly one factor', () => {
    // The property behind the two cases above, so a third branch cannot be
    // added that quietly sends neither or both.
    for (const code of [undefined, '123456', '1234567', '12345678']) {
      expect(publishAuth(code)).toHaveLength(1)
    }
  })

  it('refuses a value that is not a code, quoting what it found', () => {
    // On Windows the publish runs through a shell, so an unchecked value with a
    // metacharacter in it would be the shell's problem and not npm's.
    for (const junk of ['12345', '123456789', 'abcdef', '123 456', '123456; rm -rf /', '--otp=123456']) {
      expect(() => publishAuth(junk), `accepted ${JSON.stringify(junk)}`).toThrow(/NPM_OTP is not an authenticator code/)
    }

    expect(() => publishAuth('nope')).toThrow(/"nope"/)
  })

  it('refuses an empty NPM_OTP rather than reading it as absent', () => {
    // A job that exports the variable unset has lost the code it meant to pass,
    // not chosen the passkey flow. Falling through to a browser challenge that
    // nobody is watching would hang the release instead of failing it.
    expect(() => publishAuth('')).toThrow(/NPM_OTP is not an authenticator code/)
  })
})

describe('the client the release spawns', () => {
  const source = readFileSync(RELEASE, 'utf8')

  it('is npm, because pnpm cannot complete a passkey challenge', () => {
    // Read as text: importing the script would publish. This is the assertion
    // that would have caught the 2.0.0 failure — every other check was green.
    expect(source).toMatch(/spawnSync\(\s*['"]npm['"]/)
  })

  it('does not publish through pnpm', () => {
    expect(source).not.toMatch(/['"]pnpm['"]\s*,\s*\[\s*['"]publish['"]/)
  })

  it('takes its flags from publishAuth rather than building them again', () => {
    // Two spellings of the flag rule is the drift this file exists to stop —
    // the tests above would pin one of them and the release would use the other.
    expect(source).toMatch(/import \{ publishAuth \} from '\.\/publish-args\.mjs'/)
    expect(source).toMatch(/\.\.\.factor/)
    expect(source).not.toContain(WEB_AUTH)
    expect(source).not.toMatch(/--otp=/)
  })

  it('still confirms the version reached the registry', () => {
    // 0.2.0 shipped a changelog entry and a README badge for a version the
    // registry never received. Publishing and confirming stay one command.
    expect(source).toMatch(/verify-published\.mjs/)
  })
})
