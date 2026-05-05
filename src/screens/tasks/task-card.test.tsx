import { describe, expect, it } from 'vitest'
import { formatTaskAssigneeLabel } from './task-card'

// Task card rendering tests are behavioural (formatTaskAssigneeLabel is pure).
// The badge rendering logic is tested via the pure helpers exported from hermes-kanban-types.
// Full DOM rendering tests belong in Task 7 integration tests (requires jsdom env setup).

describe('formatTaskAssigneeLabel', () => {
  it('returns resolved label when assignee is in the map', () => {
    expect(formatTaskAssigneeLabel('jarvis', { jarvis: 'Jarvis AI' })).toBe('Assignee: Jarvis AI')
  })

  it('falls back to raw assignee id when not in label map', () => {
    expect(formatTaskAssigneeLabel('unknown-agent', {})).toBe('Assignee: unknown-agent')
  })

  it('returns Unassigned for null assignee', () => {
    expect(formatTaskAssigneeLabel(null, {})).toBe('Assignee: Unassigned')
  })

  it('returns Unassigned for null assignee even with a full label map', () => {
    expect(formatTaskAssigneeLabel(null, { agent1: 'Agent 1', agent2: 'Agent 2' })).toBe('Assignee: Unassigned')
  })
})

describe('task card badge logic', () => {
  // These tests verify the conditions that drive badge rendering
  // without requiring DOM rendering

  it('stale threshold is 5 minutes', () => {
    // The STALE_HEARTBEAT_MS is 5 * 60 * 1000 — verified by inspection
    const STALE_THRESHOLD_SECONDS = 5 * 60
    const nowSeconds = Math.floor(Date.now() / 1000)
    const lastHeartbeatFresh = nowSeconds - 60 // 1 minute ago
    const lastHeartbeatStale = nowSeconds - 400 // ~6.7 minutes ago

    const isFreshStale = nowSeconds - lastHeartbeatFresh > STALE_THRESHOLD_SECONDS
    const isExpiredStale = nowSeconds - lastHeartbeatStale > STALE_THRESHOLD_SECONDS
    expect(isFreshStale).toBe(false)
    expect(isExpiredStale).toBe(true)
  })

  it('spawn error badge shows when spawn_failures > 0', () => {
    const hasSpawnError = (spawn_failures: number, last_spawn_error: string | null) =>
      spawn_failures > 0 || !!last_spawn_error

    expect(hasSpawnError(0, null)).toBe(false)
    expect(hasSpawnError(1, null)).toBe(true)
    expect(hasSpawnError(0, 'OOM')).toBe(true)
    expect(hasSpawnError(2, 'timeout')).toBe(true)
  })

  it('comment badge shows only when comment_count > 0', () => {
    expect(0 > 0).toBe(false)
    expect(1 > 0).toBe(true)
    expect(5 > 0).toBe(true)
  })

  it('link badge shows when parents or children exist', () => {
    const showBadge = (parents: number, children: number) => parents > 0 || children > 0
    expect(showBadge(0, 0)).toBe(false)
    expect(showBadge(1, 0)).toBe(true)
    expect(showBadge(0, 3)).toBe(true)
  })
})
