import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  deriveDelegationStatus,
  readDelegationsForParent,
  toDelegation,
} from './delegations'
import type { DelegationRow } from './delegations'

const NOW = 1_000_000

function row(overrides: Partial<DelegationRow>): DelegationRow {
  return {
    id: 's1',
    agent_id: null,
    title: null,
    model: null,
    started_at: null,
    ended_at: null,
    end_reason: null,
    input_tokens: null,
    output_tokens: null,
    last_active: null,
    ...overrides,
  }
}

describe('deriveDelegationStatus', () => {
  it('is running when not ended and recently active', () => {
    expect(deriveDelegationStatus(row({ last_active: NOW - 10 }), NOW)).toBe(
      'running',
    )
  })

  it('falls back to completed when not ended but idle past the stale window', () => {
    // Real data: most child sessions never get ended_at written.
    expect(deriveDelegationStatus(row({ last_active: NOW - 3600 }), NOW)).toBe(
      'completed',
    )
    expect(deriveDelegationStatus(row({ started_at: NOW - 3600 }), NOW)).toBe(
      'completed',
    )
  })

  it('is failed when ended with an error reason', () => {
    expect(
      deriveDelegationStatus(row({ ended_at: NOW, end_reason: 'error' }), NOW),
    ).toBe('failed')
    expect(
      deriveDelegationStatus(
        row({ ended_at: NOW, end_reason: 'aborted' }),
        NOW,
      ),
    ).toBe('failed')
  })

  it('is completed when ended cleanly', () => {
    expect(
      deriveDelegationStatus(row({ ended_at: NOW, end_reason: 'stop' }), NOW),
    ).toBe('completed')
    expect(
      deriveDelegationStatus(row({ ended_at: NOW, end_reason: null }), NOW),
    ).toBe('completed')
  })
})

describe('toDelegation', () => {
  it('maps fields and converts seconds to ms', () => {
    const result = toDelegation(
      row({
        id: 'child-1',
        title: 'Do X',
        model: 'gpt',
        started_at: 100,
        ended_at: 200,
        end_reason: 'stop',
        input_tokens: 5,
        output_tokens: 7,
      }),
      NOW,
    )
    expect(result).toEqual({
      childSessionId: 'child-1',
      agentId: null,
      goal: 'Do X',
      model: 'gpt',
      status: 'completed',
      inputTokens: 5,
      outputTokens: 7,
      startedAt: 100_000,
      endedAt: 200_000,
    })
  })

  it('preserves the persisted assigned agent identity', () => {
    expect(
      toDelegation(row({ agent_id: 'neo', last_active: NOW - 5 }), NOW).agentId,
    ).toBe('neo')
  })

  it('falls back to untitled/unknown and zero tokens when missing', () => {
    const result = toDelegation(row({ id: 'c2', last_active: NOW - 5 }), NOW)
    expect(result.goal).toBe('Untitled delegation')
    expect(result.model).toBe('unknown')
    expect(result.inputTokens).toBe(0)
    expect(result.outputTokens).toBe(0)
    expect(result.startedAt).toBeNull()
    expect(result.endedAt).toBeNull()
    expect(result.status).toBe('running')
  })
})

/**
 * These cover the *reference resolution* in `readDelegationsForParent`, not
 * its query. Only the pure helpers above had tests, so nothing ever executed
 * the function body — and it called `getHermesRoot()` without importing it,
 * which threw a ReferenceError and surfaced as a 500 on
 * `GET /api/sessions/:key/delegations?profile=default`. Every case here fails
 * on the un-imported version and needs no database to do so.
 */
describe('readDelegationsForParent — profile resolution', () => {
  let previousHome: string | undefined

  beforeEach(() => {
    previousHome = process.env.HERMES_HOME
    // A directory with no state.db, so the function returns before shelling
    // out to python and the test stays hermetic.
    process.env.HERMES_HOME = mkdtempSync(join(tmpdir(), 'delegations-'))
  })

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HERMES_HOME
    else process.env.HERMES_HOME = previousHome
  })

  it('resolves the default profile to the Hermes root without throwing', () => {
    expect(readDelegationsForParent('parent-1', 'default')).toEqual([])
  })

  it('resolves a named profile', () => {
    expect(readDelegationsForParent('parent-1', 'neo')).toEqual([])
  })

  it('falls back to hermes-switch when no profile is given', () => {
    expect(readDelegationsForParent('parent-1', null)).toEqual([])
    expect(readDelegationsForParent('parent-1')).toEqual([])
  })
})
