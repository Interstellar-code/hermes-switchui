import { describe, expect, it } from 'vitest'
import { deriveDelegationStatus, toDelegation } from './delegations'
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
    expect(deriveDelegationStatus(row({ last_active: NOW - 10 }), NOW)).toBe('running')
  })

  it('falls back to completed when not ended but idle past the stale window', () => {
    // Real data: most child sessions never get ended_at written.
    expect(deriveDelegationStatus(row({ last_active: NOW - 3600 }), NOW)).toBe('completed')
    expect(deriveDelegationStatus(row({ started_at: NOW - 3600 }), NOW)).toBe('completed')
  })

  it('is failed when ended with an error reason', () => {
    expect(deriveDelegationStatus(row({ ended_at: NOW, end_reason: 'error' }), NOW)).toBe('failed')
    expect(deriveDelegationStatus(row({ ended_at: NOW, end_reason: 'aborted' }), NOW)).toBe('failed')
  })

  it('is completed when ended cleanly', () => {
    expect(deriveDelegationStatus(row({ ended_at: NOW, end_reason: 'stop' }), NOW)).toBe('completed')
    expect(deriveDelegationStatus(row({ ended_at: NOW, end_reason: null }), NOW)).toBe('completed')
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
    expect(toDelegation(row({ agent_id: 'neo', last_active: NOW - 5 }), NOW).agentId).toBe('neo')
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
