import { describe, expect, it } from 'vitest'
import {
  computeSafetyPosture,
  describeAllowlistEntry,
  revokeAllowlistEntry,
} from './safety-posture'

describe('computeSafetyPosture', () => {
  it('manual mode with an empty allowlist reads as safe', () => {
    const posture = computeSafetyPosture({
      approvalsMode: 'manual',
      commandAllowlist: [],
      tirithEnabled: true,
      tirithFailOpen: false,
    })
    expect(posture.tone).toBe('ok')
    expect(posture.headline).toContain('Manual approval')
    expect(posture.headline).toContain('nothing bypasses it')
  })

  it('manual mode with destructive allowlist entries is critical and names them', () => {
    const posture = computeSafetyPosture({
      approvalsMode: 'manual',
      commandAllowlist: [
        'recursive delete',
        'delete in root path',
        'git reset --hard (destroys uncommitted changes)',
        'git force push (rewrites remote history)',
        'SQL TRUNCATE',
        'overwrite system file via redirection',
        'force kill processes',
        'stop/restart hermes gateway (kills running agents)',
        'podman *',
        'foo',
        'bar',
        'baz',
        'qux',
        'quux',
        'corge',
        'grault',
      ],
      tirithEnabled: true,
      tirithFailOpen: true,
    })
    expect(posture.tone).toBe('critical')
    expect(posture.headline).toContain('Manual approval, but 16 commands bypass it entirely')
    expect(posture.headline).toContain('including')
    // Must call out at least one real destructive entry by name, not just a count.
    expect(posture.headline).toMatch(/recursive delete|delete in root path/)
  })

  it('auto (off) mode is always critical regardless of allowlist or tirith', () => {
    const posture = computeSafetyPosture({
      approvalsMode: 'off',
      commandAllowlist: [],
      tirithEnabled: true,
      tirithFailOpen: false,
    })
    expect(posture.tone).toBe('critical')
    expect(posture.headline).toContain('Auto-approve is on')
  })

  it('tirith disabled surfaces a note even with a clean allowlist', () => {
    const posture = computeSafetyPosture({
      approvalsMode: 'smart',
      commandAllowlist: [],
      tirithEnabled: false,
      tirithFailOpen: true,
    })
    expect(posture.tone).toBe('warning')
    expect(posture.notes.some((n) => /no pre-execution security scanner/i.test(n))).toBe(true)
  })

  it('tirith on but fail-open is flagged as a latent gap, not silently safe', () => {
    const posture = computeSafetyPosture({
      approvalsMode: 'smart',
      commandAllowlist: [],
      tirithEnabled: true,
      tirithFailOpen: true,
    })
    expect(posture.tone).toBe('warning')
    expect(posture.notes.some((n) => /fail open/i.test(n))).toBe(true)
  })

  it('tirith on and fail-closed with no allowlist is the clean/ok posture', () => {
    const posture = computeSafetyPosture({
      approvalsMode: 'smart',
      commandAllowlist: [],
      tirithEnabled: true,
      tirithFailOpen: false,
    })
    expect(posture.tone).toBe('ok')
  })

  it('unclassified allowlist globs still count as a bypass but stay warning, not critical', () => {
    const posture = computeSafetyPosture({
      approvalsMode: 'manual',
      commandAllowlist: ['podman *', 'my-custom-script.sh'],
      tirithEnabled: true,
      tirithFailOpen: false,
    })
    expect(posture.tone).toBe('warning')
    expect(posture.headline).toContain('2 commands bypass it entirely')
  })

  it('cron auto-approve adds its own note', () => {
    const posture = computeSafetyPosture({
      approvalsMode: 'smart',
      approvalsCronMode: 'approve',
      commandAllowlist: [],
      tirithEnabled: true,
      tirithFailOpen: false,
    })
    expect(posture.notes.some((n) => /cron/i.test(n))).toBe(true)
  })
})

describe('describeAllowlistEntry', () => {
  it('recognizes a known dangerous-pattern key', () => {
    const info = describeAllowlistEntry('git force push (rewrites remote history)')
    expect(info.known).toBe(true)
    expect(info.description).toMatch(/rewrites remote history/i)
  })

  it('falls back to a glob description for unknown wildcard entries', () => {
    const info = describeAllowlistEntry('podman *')
    expect(info.known).toBe(false)
    expect(info.description).toContain('podman *')
  })

  it('falls back to an exact-match description for unknown literal entries', () => {
    const info = describeAllowlistEntry('my-script.sh')
    expect(info.known).toBe(false)
    expect(info.description).toContain('my-script.sh')
  })
})

describe('revokeAllowlistEntry', () => {
  it('removes only the targeted entry', () => {
    const result = revokeAllowlistEntry(['a', 'b', 'c'], 'b')
    expect(result).toEqual(['a', 'c'])
  })

  it('is a no-op when the entry is absent', () => {
    const result = revokeAllowlistEntry(['a', 'c'], 'missing')
    expect(result).toEqual(['a', 'c'])
  })
})
