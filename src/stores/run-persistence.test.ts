// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  clearQueuedMessages,
  clearRecoveryMessage,
  persistRecoveryMessage,
  persistStreamingState,
  persistWaitingState,
  readQueuedMessages,
  removeStreamingState,
  removeWaitingState,
  restoreAllWaitingSessions,
  restoreRecoveryMessage,
  restoreStreamingState,
  writeQueuedMessages,
} from './run-persistence'

const SESSION = 'persist-test'

function clearAllStorage() {
  sessionStorage.clear()
  localStorage.clear()
}

describe('runPersistence — streaming state', () => {
  beforeEach(() => {
    clearAllStorage()
  })
  afterEach(() => {
    clearAllStorage()
  })

  it('round-trips state', () => {
    persistStreamingState(SESSION, { runId: 'r1', text: 'hello' })
    const restored = restoreStreamingState(SESSION)
    expect(restored).toMatchObject({ runId: 'r1', text: 'hello' })
  })

  it('removes state', () => {
    persistStreamingState(SESSION, { runId: 'r1' })
    removeStreamingState(SESSION)
    expect(restoreStreamingState(SESSION)).toBeNull()
  })

  it('rejects state older than 60s', () => {
    persistStreamingState(SESSION, { runId: 'r1' })
    // Backdate the _savedAt beyond the 60s TTL.
    const key = `claude_streaming_${SESSION}`
    const raw = sessionStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw) as { _savedAt: number }
      sessionStorage.setItem(
        key,
        JSON.stringify({ ...parsed, _savedAt: Date.now() - 61_000 }),
      )
    }
    expect(restoreStreamingState(SESSION)).toBeNull()
    expect(sessionStorage.getItem(key)).toBeNull()
  })
})

describe('runPersistence — recovery message', () => {
  beforeEach(() => {
    clearAllStorage()
  })
  afterEach(() => {
    clearAllStorage()
  })

  it('round-trips a message', () => {
    const message = { id: 'm1', role: 'user' }
    persistRecoveryMessage(SESSION, message)
    expect(restoreRecoveryMessage(SESSION)).toEqual(message)
  })

  it('clears on demand', () => {
    persistRecoveryMessage(SESSION, { id: 'm1' })
    clearRecoveryMessage(SESSION)
    expect(restoreRecoveryMessage(SESSION)).toBeNull()
  })

  it('rejects messages older than 5min', () => {
    persistRecoveryMessage(SESSION, { id: 'm1' })
    const key = `claude_recovery_msg_${SESSION}`
    const raw = sessionStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw) as { storedAt: number }
      sessionStorage.setItem(
        key,
        JSON.stringify({ ...parsed, storedAt: Date.now() - 301_000 }),
      )
    }
    expect(restoreRecoveryMessage(SESSION)).toBeNull()
  })
})

describe('runPersistence — waiting state', () => {
  beforeEach(() => {
    clearAllStorage()
  })
  afterEach(() => {
    clearAllStorage()
  })

  it('round-trips waiting meta', () => {
    persistWaitingState(SESSION, { since: Date.now(), runId: 'r1' })
    expect(restoreAllWaitingSessions().meta[SESSION]).toEqual({
      since: expect.any(Number),
      runId: 'r1',
    })
  })

  it('removes individual waiting', () => {
    persistWaitingState(SESSION, { since: Date.now(), runId: 'r1' })
    removeWaitingState(SESSION)
    expect(restoreAllWaitingSessions().meta[SESSION]).toBeUndefined()
  })

  it('restores multiple sessions at once', () => {
    const now = Date.now()
    persistWaitingState('s1', { since: now, runId: 'r1' })
    persistWaitingState('s2', { since: now, runId: 'r2' })
    const restored = restoreAllWaitingSessions()
    expect(restored.keys.has('s1')).toBe(true)
    expect(restored.keys.has('s2')).toBe(true)
    expect(restored.meta.s1.runId).toBe('r1')
    expect(restored.meta.s2.runId).toBe('r2')
  })

  it('rejects waiting older than 120s', () => {
    persistWaitingState(SESSION, { since: Date.now() - 121_000, runId: 'r1' })
    expect(restoreAllWaitingSessions().meta[SESSION]).toBeUndefined()
  })
})

describe('runPersistence — message queue (sessionStorage + migration)', () => {
  beforeEach(() => {
    clearAllStorage()
  })
  afterEach(() => {
    clearAllStorage()
  })

  it('round-trips queue', () => {
    const queue = [{ id: 'q1', text: 'hello' }]
    writeQueuedMessages(SESSION, queue)
    expect(readQueuedMessages(SESSION)).toEqual(queue)
  })

  it('clears queue', () => {
    writeQueuedMessages(SESSION, [{ id: 'q1' }])
    clearQueuedMessages(SESSION)
    expect(readQueuedMessages(SESSION)).toEqual([])
  })

  it('writes to sessionStorage (not localStorage)', () => {
    writeQueuedMessages(SESSION, [{ id: 'q1' }])
    expect(
      sessionStorage.getItem(`switchui:message-queue:${SESSION}`),
    ).not.toBeNull()
    expect(
      localStorage.getItem(`switchui:message-queue:${SESSION}`),
    ).toBeNull()
  })

  it('migrates from localStorage on first read', () => {
    // Simulate a pre-migration localStorage entry.
    const legacyKey = `switchui:message-queue:${SESSION}`
    const legacyQueue = [{ id: 'q1', text: 'migrated' }]
    localStorage.setItem(legacyKey, JSON.stringify(legacyQueue))

    const read = readQueuedMessages(SESSION)
    expect(read).toEqual(legacyQueue)

    // After migration, the localStorage entry should be cleared and
    // sessionStorage should hold the same data.
    expect(localStorage.getItem(legacyKey)).toBeNull()
    expect(sessionStorage.getItem(legacyKey)).not.toBeNull()
  })

  it('migration is idempotent (safe to call multiple times)', () => {
    const legacyKey = `switchui:message-queue:${SESSION}`
    localStorage.setItem(legacyKey, JSON.stringify([{ id: 'q1' }]))

    readQueuedMessages(SESSION)
    readQueuedMessages(SESSION)
    readQueuedMessages(SESSION)

    expect(localStorage.getItem(legacyKey)).toBeNull()
    expect(sessionStorage.getItem(legacyKey)).not.toBeNull()
  })

  it('migration flag prevents repeated migration attempts', () => {
    const legacyKey = `switchui:message-queue:${SESSION}`
    localStorage.setItem(legacyKey, JSON.stringify([{ id: 'q1' }]))

    // First read triggers migration + sets flag.
    readQueuedMessages(SESSION)
    expect(localStorage.getItem('switchui:queue-migrated-to-sessionstorage-v1')).toBe('1')

    // Add a new legacy entry manually (simulating a new install scenario).
    localStorage.setItem(legacyKey, JSON.stringify([{ id: 'q2' }]))

    // Reading again should NOT re-migrate because the flag is set.
    // (Migration is one-time per client; this is by design.)
    const result = readQueuedMessages(SESSION)
    expect(result).toEqual([{ id: 'q1' }]) // stale data, not q2
  })
})
