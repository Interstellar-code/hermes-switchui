import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isRecoverablePersistedRun } from './run-store'
import type { PersistedRunState } from './run-store'

function run(
  status: PersistedRunState['status'],
  lastEventAt: number,
): PersistedRunState {
  return {
    runId: `run-${status}`,
    sessionKey: 'session-1',
    friendlyId: 'session-1',
    status,
    createdAt: lastEventAt,
    updatedAt: lastEventAt,
    lastEventAt,
    assistantText: '',
    thinkingText: '',
    toolCalls: [],
    lifecycleEvents: [],
  }
}

describe('isRecoverablePersistedRun', () => {
  it('does not recover non-terminal runs from a previous SwitchUI process', () => {
    expect(
      isRecoverablePersistedRun(run('active', 10_000), 20_000, 15_000),
    ).toBe(false)
  })

  it('keeps recent accepted and handoff runs recoverable', () => {
    expect(
      isRecoverablePersistedRun(run('accepted', 10_000), 35_000, 5_000),
    ).toBe(true)
    expect(
      isRecoverablePersistedRun(run('handoff', 10_000), 35_000, 5_000),
    ).toBe(true)
  })

  it('expires accepted and handoff runs without fresh activity', () => {
    expect(
      isRecoverablePersistedRun(run('accepted', 10_000), 45_001, 5_000),
    ).toBe(false)
    expect(
      isRecoverablePersistedRun(run('handoff', 10_000), 45_001, 5_000),
    ).toBe(false)
  })

  it('does not recover terminal or stalled runs', () => {
    expect(
      isRecoverablePersistedRun(run('complete', 10_000), 20_000, 5_000),
    ).toBe(false)
    expect(isRecoverablePersistedRun(run('error', 10_000), 20_000, 5_000)).toBe(
      false,
    )
    expect(
      isRecoverablePersistedRun(run('stalled', 10_000), 20_000, 5_000),
    ).toBe(false)
  })
})

describe('run-store — atomic writes', () => {
  let tempDir: string
  let origEnv: string | undefined

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-run-store-atomic-'))
    origEnv = process.env.HOME
    // getHermesRoot() uses HOME; point it at our temp dir so RUNS_ROOT lands there
    process.env.HOME = tempDir
    vi.resetModules()
  })

  afterEach(() => {
    process.env.HOME = origEnv
    fs.rmSync(tempDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('createPersistedRun round-trips and leaves no .tmp file behind', async () => {
    const { createPersistedRun, getPersistedRun } = await import('./run-store')

    const created = await createPersistedRun({
      runId: 'run-atomic-1',
      sessionKey: 'sess-atomic',
      friendlyId: 'friendly-1',
    })
    expect(created.runId).toBe('run-atomic-1')

    const retrieved = await getPersistedRun('sess-atomic', 'run-atomic-1')
    expect(retrieved).not.toBeNull()
    expect(retrieved!.runId).toBe('run-atomic-1')
    expect(retrieved!.status).toBe('accepted')

    // No .tmp files left behind anywhere under the tempDir
    const walk = (dir: string): Array<string> => {
      if (!fs.existsSync(dir)) return []
      return fs.readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name)
        return fs.statSync(full).isDirectory() ? walk(full) : [full]
      })
    }
    const tmpFiles = walk(tempDir).filter((f) => f.endsWith('.tmp'))
    expect(tmpFiles).toHaveLength(0)
  })
})
