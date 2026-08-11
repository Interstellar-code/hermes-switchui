import { afterEach, describe, expect, it } from 'vitest'
import {
  INITIAL_SETTINGS_STATE,
  resetSettingsStore,
  useSettingsStore,
} from './settings-store'
import type { SaveOutcome } from '@/screens/settings/lib/saver'

const s = () => useSettingsStore.getState()

function ok(persisted: Array<string>): SaveOutcome {
  return { persisted, failed: [] }
}

afterEach(() => {
  resetSettingsStore()
})

describe('draft density invariant', () => {
  it('resolves defaults, committed and edits into one dense map', () => {
    s().registerDefaults({ 'config.logging.level': 'INFO' })
    s().seed({ 'config.terminal.timeout': 90 })
    s().set('config.terminal.timeout', 120)

    // ~200 call sites read draft['config.x'] directly and must never see
    // undefined for a key any layer knows about.
    expect(s().draft['config.logging.level']).toBe('INFO')
    expect(s().draft['config.terminal.timeout']).toBe(120)
    expect(s().committed['config.terminal.timeout']).toBe(90)
    expect(s().committed['config.logging.level']).toBe(undefined)
  })
})

describe('seed', () => {
  it('is the only thing that sets status', () => {
    expect(s().status).toBe('empty')
    s().registerDefaults({ 'config.a': 1 })
    expect(s().status).toBe('empty')
    s().seed({ 'config.b': 2 })
    expect(s().status).toBe('seeded')
  })

  it('non-forced keeps a dirty draft on top of new server truth', () => {
    s().seed({ 'config.a': 1, 'config.b': 2 })
    s().set('config.a', 99)

    s().seed({ 'config.a': 5, 'config.b': 7 })

    expect(s().draft['config.a']).toBe(99)
    expect(s().dirty.has('config.a')).toBe(true)
    expect(s().committed['config.a']).toBe(5)
    // An untouched key follows the server.
    expect(s().draft['config.b']).toBe(7)
  })

  it('non-forced drops an edit the server has caught up with', () => {
    s().seed({ 'config.a': 1 })
    s().set('config.a', 99)

    s().seed({ 'config.a': 99 })

    expect(s().dirty.size).toBe(0)
    expect(s().draft['config.a']).toBe(99)
  })

  it('force clears drafts — Refresh promises a reload from disk', () => {
    s().seed({ 'config.a': 1 })
    s().set('config.a', 99)

    s().seed({ 'config.a': 5 }, { force: true })

    expect(s().dirty.size).toBe(0)
    expect(s().draft['config.a']).toBe(5)
  })
})

describe('registerDefaults', () => {
  it('never clears another section\'s dirty state', () => {
    s().seed({ 'config.terminal.timeout': 90 })
    s().set('config.terminal.timeout', 120)

    s().registerDefaults({ 'config.logging.level': 'INFO' })

    expect(s().dirty.has('config.terminal.timeout')).toBe(true)
    expect(s().draft['config.terminal.timeout']).toBe(120)
    expect(s().status).toBe('seeded')
  })

  it('is idempotent and order-independent', () => {
    s().registerDefaults({ 'config.a': 1 })
    s().registerDefaults({ 'config.a': 2, 'config.b': 3 })

    expect(s().draft['config.a']).toBe(1)
    expect(s().draft['config.b']).toBe(3)
    expect(s().dirty.size).toBe(0)
  })

  it('keeps fabricated values out of committed so Export stays honest', () => {
    s().seed({ 'config.a': 1 })
    s().registerDefaults({ 'config.logging.level': 'INFO' })

    expect(s().committed).toEqual({ 'config.a': 1 })
  })

  it('never overrides server truth', () => {
    s().seed({ 'config.logging.level': 'DEBUG' })
    s().registerDefaults({ 'config.logging.level': 'INFO' })

    expect(s().draft['config.logging.level']).toBe('DEBUG')
  })
})

describe('array identity', () => {
  /**
   * `config.command_allowlist`, `config.terminal.docker_volumes` and
   * `config.skills.external_dirs` rebuild a fresh array on every keystroke.
   * Under `!==` they could never return to clean, so Save kept shipping a
   * no-op patch for them forever.
   */
  it('returns to clean when a rebuilt array matches committed again', () => {
    s().seed({ 'config.command_allowlist': ['ls', 'cat'] })

    s().set('config.command_allowlist', ['ls', 'cat', 'rm'])
    expect(s().dirty.has('config.command_allowlist')).toBe(true)

    s().set('config.command_allowlist', ['ls', 'cat'])
    expect(s().dirty.has('config.command_allowlist')).toBe(false)
    expect(s().dirty.size).toBe(0)
  })

  it('still sees a real array change', () => {
    s().seed({ 'config.command_allowlist': ['ls'] })
    s().set('config.command_allowlist', ['cat'])
    expect(s().dirty.has('config.command_allowlist')).toBe(true)
  })
})

describe('importValues', () => {
  it('marks keys dirty without mutating committed', () => {
    s().seed({ 'config.a': 1, 'config.b': 2 })

    const changed = s().importValues({ 'config.a': 42 })

    expect(changed).toBe(1)
    expect(s().dirty.size).toBe(1)
    expect(s().dirty.has('config.a')).toBe(true)
    expect(s().committed).toEqual({ 'config.a': 1, 'config.b': 2 })
    expect(s().draft['config.a']).toBe(42)
  })

  it('does not fabricate a change for a value that already matches', () => {
    s().seed({ 'config.a': 1 })
    expect(s().importValues({ 'config.a': 1 })).toBe(0)
    expect(s().dirty.size).toBe(0)
  })
})

describe('discard', () => {
  it('reverts one key and leaves the rest dirty', () => {
    s().seed({ 'config.a': 1, 'config.b': 2 })
    s().set('config.a', 10)
    s().set('config.b', 20)

    s().discard('config.a')

    expect(s().draft['config.a']).toBe(1)
    expect(s().dirty.has('config.a')).toBe(false)
    expect(s().dirty.has('config.b')).toBe(true)
  })

  it('discardAll reverts every edit', () => {
    s().seed({ 'config.a': 1, 'config.b': 2 })
    s().setMany({ 'config.a': 10, 'config.b': 20 })

    s().discardAll()

    expect(s().dirty.size).toBe(0)
    expect(s().draft).toEqual({ 'config.a': 1, 'config.b': 2 })
  })
})

describe('save', () => {
  /**
   * The original bug: the saver's 405 was swallowed and the store committed
   * the draft unconditionally, so the bar read "Saved" for a write that never
   * happened.
   */
  it('leaves committed byte-identical and dirty intact when nothing persisted', async () => {
    s().seed({ 'config.approvals.mode': 'manual' })
    s().set('config.approvals.mode', 'auto')
    const committedBefore = JSON.stringify(s().committed)

    const outcome = await s().save(() =>
      Promise.resolve({
        persisted: [],
        failed: [
          {
            key: 'config.approvals.mode',
            reason: 'Hermes Dashboard API PUT /api/config: 405',
          },
        ],
      }),
    )

    expect(JSON.stringify(s().committed)).toBe(committedBefore)
    expect(s().dirty.has('config.approvals.mode')).toBe(true)
    expect(s().draft['config.approvals.mode']).toBe('auto')
    expect(s().saveState.phase).toBe('error')
    expect(s().saveState.error).toContain('405')
    expect(outcome.persisted).toEqual([])
  })

  it('does not reject when the saver rejects', async () => {
    s().seed({ 'config.a': 1 })
    s().set('config.a', 2)
    const committedBefore = JSON.stringify(s().committed)

    let threw = false
    const outcome = await s()
      .save(() => Promise.reject(new Error('gateway unreachable')))
      .catch(() => {
        threw = true
        return { persisted: [], failed: [] }
      })

    expect(threw).toBe(false)
    expect(JSON.stringify(s().committed)).toBe(committedBefore)
    expect(s().dirty.has('config.a')).toBe(true)
    expect(s().saveState.phase).toBe('error')
    expect(s().saveState.error).toBe('gateway unreachable')
    expect(outcome.failed).toEqual([
      { key: 'config.a', reason: 'gateway unreachable' },
    ])
  })

  it('commits only the persisted keys on a partial success', async () => {
    s().seed({ 'config.a': 1, 'config.b': 2 })
    s().setMany({ 'config.a': 10, 'config.b': 20 })

    await s().save(() =>
      Promise.resolve({
        persisted: ['config.a'],
        failed: [{ key: 'config.b', reason: 'unsupported key' }],
      }),
    )

    expect(s().committed).toEqual({ 'config.a': 10, 'config.b': 2 })
    expect([...s().dirty]).toEqual(['config.b'])
    expect(s().saveState.failures).toEqual([
      { key: 'config.b', reason: 'unsupported key' },
    ])
  })

  it('clears dirty and records success when everything lands', async () => {
    s().seed({ 'config.a': 1 })
    s().set('config.a', 10)

    await s().save(() => Promise.resolve(ok(['config.a'])))

    expect(s().dirty.size).toBe(0)
    expect(s().committed['config.a']).toBe(10)
    expect(s().saveState.phase).toBe('success')
    expect(typeof s().saveState.lastSavedAt).toBe('number')
  })

  it('keeps a key dirty when it is edited again mid-flight', async () => {
    s().seed({ 'config.a': 1 })
    s().set('config.a', 10)

    const pending = s().save(async (patch) => {
      // The user keeps typing while the request is in the air.
      s().set('config.a', 11)
      await Promise.resolve()
      return ok(Object.keys(patch))
    })
    await pending

    // The server has value 10; the user is now on 11 and must stay dirty.
    expect(s().committed['config.a']).toBe(10)
    expect(s().draft['config.a']).toBe(11)
    expect(s().dirty.has('config.a')).toBe(true)
  })

  it('is a no-op while a save is already in flight', async () => {
    s().seed({ 'config.a': 1 })
    s().set('config.a', 10)

    let calls = 0
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = s().save(async () => {
      calls++
      await gate
      return ok(['config.a'])
    })
    const second = await s().save(async () => {
      calls++
      return ok(['config.a'])
    })

    expect(second).toEqual({ persisted: [], failed: [] })
    release!()
    await first
    expect(calls).toBe(1)
  })

  it('does nothing when there is nothing dirty', async () => {
    s().seed({ 'config.a': 1 })
    let called = false
    const outcome = await s().save(() => {
      called = true
      return Promise.resolve(ok([]))
    })
    expect(called).toBe(false)
    expect(outcome).toEqual({ persisted: [], failed: [] })
  })
})

describe('resetSettingsStore', () => {
  it('restores the initial shape without hand-listing mutable fields', () => {
    s().seed({ 'config.a': 1 })
    s().registerDefaults({ 'config.b': 2 })
    s().set('config.a', 9)

    resetSettingsStore()

    expect(s().status).toBe('empty')
    expect(s().committed).toEqual({})
    expect(s().defaults).toEqual({})
    expect(s().draft).toEqual({})
    expect(s().dirty.size).toBe(0)
    expect(s().saveState.phase).toBe('idle')
  })

  it('does not alias the exported initial state, whose Set is shared', () => {
    resetSettingsStore()
    s().set('config.a', 1)
    // Tests used to hand-list the mutable fields; if a reset ever aliased
    // INITIAL_SETTINGS_STATE.dirty, one test would leak into the next.
    expect(INITIAL_SETTINGS_STATE.dirty.size).toBe(0)
    expect(s().dirty).not.toBe(INITIAL_SETTINGS_STATE.dirty)
  })
})
