import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Concurrency tests for updatePersistedRun.
 *
 * Verifies that the per-runId async mutex prevents concurrent read-modify-write
 * races from losing updates. Without the lock, N concurrent incrementers would
 * all read the same stale value and the final count would be 1; with the lock
 * the chain serialises them and the final count equals N.
 */

describe('run-store — concurrent updatePersistedRun serialisation', () => {
  let tempDir: string
  let origHome: string | undefined

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-run-store-conc-'))
    origHome = process.env.HOME
    // getHermesRoot() resolves from HOME; redirect so RUNS_ROOT lands in tempDir
    process.env.HOME = tempDir
    vi.resetModules()
  })

  afterEach(() => {
    process.env.HOME = origHome
    fs.rmSync(tempDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('does not lose updates when N callers race concurrently on the same runId', async () => {
    const { createPersistedRun, updatePersistedRun } = await import('./run-store')

    await createPersistedRun({
      runId: 'run-conc-1',
      sessionKey: 'sess-conc',
      friendlyId: 'friendly-conc-1',
    })

    const N = 20
    // Each concurrent call appends a distinct token to assistantText.
    // Without serialisation the last-writer-wins and only 1 token survives.
    const updates = Array.from({ length: N }, (_, i) =>
      updatePersistedRun('sess-conc', 'run-conc-1', (run) => ({
        ...run,
        assistantText: run.assistantText + `[token-${i}]`,
      })),
    )

    await Promise.all(updates)

    const { getPersistedRun } = await import('./run-store')
    const final = await getPersistedRun('sess-conc', 'run-conc-1')
    expect(final).not.toBeNull()

    // Every token must appear in the final text exactly once.
    for (let i = 0; i < N; i++) {
      expect(final!.assistantText).toContain(`[token-${i}]`)
    }
    expect((final!.assistantText.match(/\[token-\d+\]/g) ?? []).length).toBe(N)
  })

  it('serialises updates across multiple concurrent runs independently', async () => {
    const { createPersistedRun, updatePersistedRun, getPersistedRun } =
      await import('./run-store')

    // Two runs in the same session; each should accumulate its own N tokens.
    await Promise.all([
      createPersistedRun({ runId: 'run-a', sessionKey: 'sess-multi', friendlyId: 'a' }),
      createPersistedRun({ runId: 'run-b', sessionKey: 'sess-multi', friendlyId: 'b' }),
    ])

    const M = 10
    const updatesA = Array.from({ length: M }, (_, i) =>
      updatePersistedRun('sess-multi', 'run-a', (run) => ({
        ...run,
        assistantText: run.assistantText + `[A-${i}]`,
      })),
    )
    const updatesB = Array.from({ length: M }, (_, i) =>
      updatePersistedRun('sess-multi', 'run-b', (run) => ({
        ...run,
        assistantText: run.assistantText + `[B-${i}]`,
      })),
    )

    await Promise.all([...updatesA, ...updatesB])

    const [finalA, finalB] = await Promise.all([
      getPersistedRun('sess-multi', 'run-a'),
      getPersistedRun('sess-multi', 'run-b'),
    ])

    expect(finalA).not.toBeNull()
    expect(finalB).not.toBeNull()

    for (let i = 0; i < M; i++) {
      expect(finalA!.assistantText).toContain(`[A-${i}]`)
      expect(finalB!.assistantText).toContain(`[B-${i}]`)
    }
    expect((finalA!.assistantText.match(/\[A-\d+\]/g) ?? []).length).toBe(M)
    expect((finalB!.assistantText.match(/\[B-\d+\]/g) ?? []).length).toBe(M)
    // Cross-contamination check
    expect(finalA!.assistantText).not.toContain('[B-')
    expect(finalB!.assistantText).not.toContain('[A-')
  })

  it('callers such as appendRunText and markRunStatus still return correct values', async () => {
    const { createPersistedRun, appendRunText, markRunStatus, getPersistedRun } =
      await import('./run-store')

    await createPersistedRun({
      runId: 'run-helper',
      sessionKey: 'sess-helper',
      friendlyId: 'helper',
    })

    // Fire helpers concurrently; each wraps updatePersistedRun internally.
    await Promise.all([
      appendRunText('sess-helper', 'run-helper', 'hello '),
      appendRunText('sess-helper', 'run-helper', 'world'),
    ])

    await markRunStatus('sess-helper', 'run-helper', 'complete')

    const final = await getPersistedRun('sess-helper', 'run-helper')
    expect(final).not.toBeNull()
    expect(final!.status).toBe('complete')
    // Both text chunks must be present (order may vary, but both survive).
    expect(final!.assistantText).toContain('hello ')
    expect(final!.assistantText).toContain('world')
  })
})
