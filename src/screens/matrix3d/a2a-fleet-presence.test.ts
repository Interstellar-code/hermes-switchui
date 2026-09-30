import { describe, expect, it } from 'vitest'
import {
  buildFleetPresence,
  isPeerBusy,
  parseFleetTimestamp,
} from './a2a-fleet-presence'

function localTs(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const NOW = new Date(2026, 8, 30, 18, 0, 0).getTime()

describe('a2a fleet busy inference', () => {
  it('parses tz-less timestamps as local time', () => {
    expect(parseFleetTimestamp('2026-09-30 18:00:00')).toBe(NOW)
    expect(parseFleetTimestamp(null)).toBeNull()
  })

  it('is busy while Hermes awaits a reply, within 10 minutes', () => {
    const conv = {
      last_dir: 'hermes->claude-code',
      last_text: 'Review the diff',
      last_ts: localTs(NOW - 60_000),
    }
    expect(isPeerBusy(conv, NOW)).toBe(true)
    expect(
      isPeerBusy({ ...conv, last_ts: localTs(NOW - 11 * 60_000) }, NOW),
    ).toBe(false)
  })

  it('treats a [queued] ack as still working, a real reply as done', () => {
    const ack = {
      last_dir: 'opencode->hermes',
      last_text: 'Message received; Reply will follow. [queued]',
      last_ts: localTs(NOW - 30_000),
    }
    expect(isPeerBusy(ack, NOW)).toBe(true)
    expect(isPeerBusy({ ...ack, last_text: 'Done: tests pass.' }, NOW)).toBe(
      false,
    )
    // A reply that merely mentions the marker mid-text is a real reply.
    expect(
      isPeerBusy(
        { ...ack, last_text: 'No [queued] work left, all done.' },
        NOW,
      ),
    ).toBe(false)
    expect(isPeerBusy({ ...ack, last_text: '[queued] ok' }, NOW)).toBe(true)
  })

  it('ignores timestamps in the future beyond clock skew', () => {
    const conv = { last_dir: 'hermes->agy', last_text: 'go' }
    expect(isPeerBusy({ ...conv, last_ts: localTs(NOW + 30_000) }, NOW)).toBe(
      true,
    )
    expect(
      isPeerBusy({ ...conv, last_ts: localTs(NOW + 5 * 60_000) }, NOW),
    ).toBe(false)
  })

  it('builds one character per peer from its newest conversation', () => {
    const fleet = buildFleetPresence(
      [
        {
          name: 'claude-code',
          repo_path: '/Users/x/.hermes/hermes-agent',
          mode: 'claude_code',
          transcript_exists: true,
          message_count: 3,
        },
        {
          name: 'agy',
          repo_path: null,
          mode: 'agy',
          transcript_exists: false,
          message_count: 0,
        },
      ],
      [
        {
          contextId: 'old',
          peer: 'claude-code',
          repo_path: null,
          message_count: 1,
          last_ts: localTs(NOW - 3_600_000),
          last_dir: 'claude->hermes',
          last_text: 'old reply',
        },
        {
          contextId: 'new',
          peer: 'claude-code',
          repo_path: null,
          message_count: 1,
          last_ts: localTs(NOW - 5_000),
          last_dir: 'hermes->claude-code',
          last_text: '  Run   the audit  ',
        },
      ],
      NOW,
    )
    expect(fleet[0]).toMatchObject({
      id: 'a2a:claude-code',
      name: 'claude-code · hermes-agent',
      busy: true,
      bubble: 'Run the audit',
    })
    expect(fleet[1]).toMatchObject({
      id: 'a2a:agy',
      name: 'agy',
      busy: false,
      bubble: null,
    })
  })
})
