import { describe, expect, it } from 'vitest'
import {
  approvalChoiceLabel,
  approvalChoiceWeight,
  approvalMsRemaining,
  approvalQuestion,
  fallbackApprovalChoices,
  formatApprovalCountdown,
  isApprovalChoice,
  isPermanentChoice,
  parseApprovalDetail,
} from './approvals'

/**
 * Fixtures are shaped exactly as approval contract v1 §1 — snake_case, flat,
 * `smart_denied` present ONLY when true.
 */
const FULL = {
  interaction_id: 'approval_ab12cd34ef',
  kind: 'approval',
  run_id: 'run_1111',
  session_id: 'sess-1',
  choices: ['once', 'session', 'always', 'deny'],
  command: 'cp ./x /etc/systemd/system/x.service',
  description: 'copy/move file into system config path',
  pattern_key: 'shell-c',
  pattern_keys: ['shell-c', 'file-write-system'],
  allow_permanent: true,
  expires_at: '2026-08-10T09:31:00Z',
}

describe('parseApprovalDetail', () => {
  it('reads every contract §1 field off the flat snake_case payload', () => {
    expect(parseApprovalDetail(FULL)).toEqual({
      runId: 'run_1111',
      command: 'cp ./x /etc/systemd/system/x.service',
      description: 'copy/move file into system config path',
      patternKey: 'shell-c',
      patternKeys: ['shell-c', 'file-write-system'],
      allowPermanent: true,
      smartDenied: undefined,
      expiresAt: '2026-08-10T09:31:00Z',
    })
  })

  it('refuses a payload with no run_id — resolution is keyed by it alone', () => {
    const { run_id: _dropped, ...noRun } = FULL
    expect(parseApprovalDetail(noRun)).toBeNull()
    expect(parseApprovalDetail(null)).toBeNull()
    expect(parseApprovalDetail('run_1')).toBeNull()
  })

  it('treats smart_denied as absent-means-false, never !== false', () => {
    expect(parseApprovalDetail(FULL)?.smartDenied).toBeUndefined()
    expect(
      parseApprovalDetail({ ...FULL, smart_denied: true })?.smartDenied,
    ).toBe(true)
    // A literal false must not become `true` via a sloppy `!== false`.
    expect(
      parseApprovalDetail({ ...FULL, smart_denied: false })?.smartDenied,
    ).toBeUndefined()
  })

  it('mirrors the gateway: a missing allow_permanent is not a denial', () => {
    const { allow_permanent: _drop, ...noFlag } = FULL
    expect(parseApprovalDetail(noFlag)?.allowPermanent).toBeUndefined()
    expect(
      parseApprovalDetail({ ...FULL, allow_permanent: false })?.allowPermanent,
    ).toBe(false)
  })

  it('also accepts camelCase, so the same parser serves both hops', () => {
    expect(
      parseApprovalDetail({ runId: 'run_2', patternKeys: ['a'], expiresAt: 'z' }),
    ).toMatchObject({ runId: 'run_2', patternKeys: ['a'], expiresAt: 'z' })
  })
})

describe('fallbackApprovalChoices', () => {
  // Only used when a payload arrives without `choices`; the event array is
  // authoritative. Mirrors `_approval_event_choices`.
  it('smart-denied offers one operation only, never persistence', () => {
    expect(fallbackApprovalChoices({ smartDenied: true })).toEqual([
      'once',
      'deny',
    ])
    expect(
      fallbackApprovalChoices({ smartDenied: true, allowPermanent: true }),
    ).toEqual(['once', 'deny'])
  })

  it('drops always when a tirith finding blocks permanent allowlisting', () => {
    expect(fallbackApprovalChoices({ allowPermanent: false })).toEqual([
      'once',
      'session',
      'deny',
    ])
  })

  it('offers all four for a normal dangerous-command approval', () => {
    expect(fallbackApprovalChoices({ allowPermanent: true })).toEqual([
      'once',
      'session',
      'always',
      'deny',
    ])
  })
})

describe('choice semantics', () => {
  it('only always is permanent, and it is weighted apart from the rest', () => {
    expect(isPermanentChoice('always')).toBe(true)
    expect(isPermanentChoice('ALWAYS')).toBe(true)
    expect(isPermanentChoice('once')).toBe(false)
    expect(approvalChoiceWeight('always')).toBe('permanent')
    expect(approvalChoiceWeight('once')).toBe('primary')
    expect(approvalChoiceWeight('session')).toBe('primary')
    expect(approvalChoiceWeight('deny')).toBe('quiet')
  })

  it('labels the known enum and passes anything else through verbatim', () => {
    expect(approvalChoiceLabel('once')).toBe('Allow once')
    expect(approvalChoiceLabel('always')).toBe('Always allow')
    expect(approvalChoiceLabel('escalate-to-ops')).toBe('escalate-to-ops')
    expect(isApprovalChoice('escalate-to-ops')).toBe(false)
  })
})

describe('approvalQuestion', () => {
  it('prefers the description, since the payload has no question field', () => {
    expect(approvalQuestion({ runId: 'r', description: 'wipe disk' })).toBe(
      'wipe disk',
    )
    expect(approvalQuestion({ runId: 'r', command: 'rm -rf /tmp/x' })).toBe(
      'Approve this command?',
    )
    expect(approvalQuestion({ runId: 'r' })).toBe('Approve this action?')
  })
})

describe('countdown', () => {
  it('measures against the absolute deadline, not an assumed 60s', () => {
    const now = Date.parse('2026-08-10T09:30:00Z')
    expect(approvalMsRemaining('2026-08-10T09:30:45Z', now)).toBe(45_000)
    expect(approvalMsRemaining('2026-08-10T09:29:50Z', now)).toBe(-10_000)
    expect(approvalMsRemaining(undefined, now)).toBeNull()
    expect(approvalMsRemaining('not-a-date', now)).toBeNull()
  })

  it('never renders a negative clock', () => {
    expect(formatApprovalCountdown(45_000)).toBe('0:45')
    expect(formatApprovalCountdown(61_000)).toBe('1:01')
    expect(formatApprovalCountdown(-5_000)).toBe('0:00')
  })
})
