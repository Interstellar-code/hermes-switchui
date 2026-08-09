import { describe, expect, it } from 'vitest'

import {
  importErrorMessage,
  parseProfileBundle,
  suggestImportName,
} from './profiles-screen'
import { exportFileName } from './components/profile-detail-drawer'

/**
 * Import/export UI logic (G-03). The route handlers are tested in
 * `src/routes/api/profiles/__tests__/-import.test.ts`; what is tested here is
 * the part the user actually meets — whether a wrong file is rejected with a
 * sentence that says what is wrong, and whether the four failure modes the
 * backend distinguishes (409 / 413 / 400 / other) stay distinguished by the
 * time they reach a toast.
 */

const VALID = {
  schemaVersion: 1,
  name: 'my-agent',
  config: { description: 'x' },
  skills: {},
}

describe('parseProfileBundle', () => {
  it('accepts a well-formed bundle', () => {
    const result = parseProfileBundle(JSON.stringify(VALID))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.bundle.name).toBe('my-agent')
  })

  it('accepts a bundle with no skills key at all', () => {
    const { skills: _skills, ...noSkills } = VALID
    expect(parseProfileBundle(JSON.stringify(noSkills)).ok).toBe(true)
  })

  it('rejects a file that is not JSON, naming the expected file', () => {
    const result = parseProfileBundle('not json at all {')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/not valid JSON/)
      expect(result.error).toMatch(/\.hermes-profile\.json/)
    }
  })

  it('rejects JSON that is not an object', () => {
    for (const text of ['[]', '"a string"', '42', 'null']) {
      const result = parseProfileBundle(text)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/not a Hermes profile bundle/)
    }
  })

  it('names the version it cannot read rather than saying "bad schema"', () => {
    const result = parseProfileBundle(JSON.stringify({ ...VALID, schemaVersion: 2 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/version 2/)
  })

  it('rejects a bundle with no schemaVersion', () => {
    const { schemaVersion: _v, ...noVersion } = VALID
    const result = parseProfileBundle(JSON.stringify(noVersion))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/missing a schemaVersion/)
  })

  it('rejects a bundle with no name and one with no config', () => {
    const noName = parseProfileBundle(JSON.stringify({ ...VALID, name: '  ' }))
    expect(noName.ok).toBe(false)
    if (!noName.ok) expect(noName.error).toMatch(/no agent name/)

    const noConfig = parseProfileBundle(JSON.stringify({ ...VALID, config: 'nope' }))
    expect(noConfig.ok).toBe(false)
    if (!noConfig.ok) expect(noConfig.error).toMatch(/no config/)
  })

  it('rejects a non-object skills map', () => {
    const result = parseProfileBundle(JSON.stringify({ ...VALID, skills: ['a'] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/skills/)
  })
})

describe('importErrorMessage — the backend distinguishes these, so must the UI', () => {
  it('413 says the bundle is too large and names the ceiling', () => {
    const message = importErrorMessage(413, 'Skills tree exceeds export size limit')
    expect(message).toMatch(/too large/)
    expect(message).toMatch(/10 MiB/)
  })

  it('400 surfaces the specific server reason (bad schema, path traversal, …)', () => {
    expect(importErrorMessage(400, 'Invalid skills path: ../../etc/passwd')).toMatch(
      /Invalid skills path: \.\.\/\.\.\/etc\/passwd/,
    )
    expect(importErrorMessage(400, 'Invalid profile bundle: config must be an object')).toMatch(
      /config must be an object/,
    )
  })

  it('403 surfaces the reserved-name reason', () => {
    expect(
      importErrorMessage(403, 'Profile name "neo" is reserved for built-in agents'),
    ).toMatch(/reserved for built-in agents/)
  })

  it('401 tells the user to reload rather than reporting a schema problem', () => {
    expect(importErrorMessage(401)).toMatch(/signed in/)
  })

  it('never collapses a known status into a bare "Import failed"', () => {
    for (const status of [400, 401, 403, 413]) {
      expect(importErrorMessage(status, 'server said so')).not.toMatch(/^Import failed/)
    }
  })

  it('falls back to the server message, then to the status, for anything unmapped', () => {
    expect(importErrorMessage(500, 'boom')).toBe('boom')
    expect(importErrorMessage(500)).toBe('Import failed (500)')
  })
})

describe('suggestImportName — the 409 prompt opens on a name that will work', () => {
  it('keeps the bundle name when nothing is using it', () => {
    expect(suggestImportName('my-agent', ['other'])).toBe('my-agent')
  })

  it('walks to the first free suffix', () => {
    expect(suggestImportName('my-agent', ['my-agent'])).toBe('my-agent-2')
    expect(suggestImportName('my-agent', ['my-agent', 'my-agent-2'])).toBe('my-agent-3')
  })

  it('compares case-insensitively, the way the server list does', () => {
    expect(suggestImportName('My-Agent', ['my-agent'])).toBe('my-agent-2')
  })

  it('sanitises a hostile name rather than proposing one the server will reject', () => {
    expect(suggestImportName('../../etc/passwd', [])).not.toMatch(/[./]/)
  })
})

describe('exportFileName', () => {
  it('names the download after the profile', () => {
    expect(exportFileName('my-agent')).toBe('my-agent.hermes-profile.json')
  })
})
