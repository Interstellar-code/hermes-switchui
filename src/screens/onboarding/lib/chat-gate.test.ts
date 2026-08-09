import { describe, expect, it } from 'vitest'

import {
  CHAT_GATE_UNTESTED,
  buildSkipWarning,
  gateBlockReason,
  isGateProven,
  isGateSettled,
} from './chat-gate'
import { detectOllamaContext } from './ollama-context'
import type { ChatGateState } from './chat-gate'

const PASSED: ChatGateState = { kind: 'passed', reply: 'Hello.' }
const SKIPPED: ChatGateState = { kind: 'skipped', at: 1 }
const CREDENTIAL_FAILURE: ChatGateState = {
  kind: 'failed',
  error: '401 invalid x-api-key',
  credentialLikely: true,
}
const OUTAGE: ChatGateState = {
  kind: 'failed',
  error: 'connection refused',
  credentialLikely: false,
}

describe('gate settlement', () => {
  it('is settled by a success or by an accepted skip, and by nothing else', () => {
    expect(isGateSettled(PASSED)).toBe(true)
    expect(isGateSettled(SKIPPED)).toBe(true)
    expect(isGateSettled(CHAT_GATE_UNTESTED)).toBe(false)
    expect(isGateSettled({ kind: 'sending' })).toBe(false)
    expect(isGateSettled(OUTAGE)).toBe(false)
  })

  it('distinguishes "settled" from "proven"', () => {
    // The skip settles the flow but proves nothing, and the finish screen has
    // to be able to tell the two apart before it claims setup is complete.
    expect(isGateProven(PASSED)).toBe(true)
    expect(isGateProven(SKIPPED)).toBe(false)
  })
})

describe('buildSkipWarning', () => {
  it('leads with the fact that nothing will answer when no provider is active', () => {
    const lines = buildSkipWarning({
      state: CHAT_GATE_UNTESTED,
      activeProvider: null,
    })
    expect(lines[0]).toContain('No provider is active')
  })

  it("leads with the gateway's own words on a credential failure", () => {
    const lines = buildSkipWarning({
      state: CREDENTIAL_FAILURE,
      activeProvider: 'anthropic',
    })
    expect(lines[0]).toContain('401 invalid x-api-key')
    expect(lines[0]).toContain('rejected the credential')
  })

  it('quotes a non-credential failure without misattributing it', () => {
    const lines = buildSkipWarning({
      state: OUTAGE,
      activeProvider: 'anthropic',
    })
    expect(lines[0]).toContain('connection refused')
    expect(lines[0]).not.toContain('credential')
  })

  it('says "unverified" rather than "broken" when nothing has been tried', () => {
    const lines = buildSkipWarning({
      state: CHAT_GATE_UNTESTED,
      activeProvider: 'anthropic',
    })
    expect(lines[0]).toContain('unverified rather than known-broken')
  })

  it('names the concrete casualties, not a generic disclaimer', () => {
    // The decision on this gate was "skip with warning", and the warning has
    // to be specific about what breaks or it teaches nobody anything.
    const joined = buildSkipWarning({
      state: OUTAGE,
      activeProvider: 'anthropic',
    }).join(' ')
    expect(joined).toContain('the stream will end in an error')
    expect(joined).toContain('Tool calls, terminal commands and file edits')
    expect(joined).toContain('Memory writes happen during a turn')
    expect(joined).toContain('Skills, MCP servers and scheduled jobs')
  })

  it('folds in the context-window problem, which is a load failure not a bad answer', () => {
    const lines = buildSkipWarning({
      state: OUTAGE,
      activeProvider: 'ollama',
      ollama: detectOllamaContext({ providerId: 'ollama', config: {} }),
    })
    expect(lines.join(' ')).toContain('rejects undersized models at startup')
  })

  it('leaves the context line out when the window is fine', () => {
    const lines = buildSkipWarning({
      state: OUTAGE,
      activeProvider: 'ollama',
      ollama: detectOllamaContext({
        providerId: 'ollama',
        config: { providers: { ollama: { context_length: 64000 } } },
      }),
    })
    expect(lines.join(' ')).not.toContain('rejects undersized models')
  })
})

describe('gateBlockReason', () => {
  it('is empty once the gate is settled', () => {
    expect(gateBlockReason(PASSED)).toEqual([])
    expect(gateBlockReason(SKIPPED)).toEqual([])
  })

  it('quotes the failure while one is standing', () => {
    expect(gateBlockReason(OUTAGE)[0]).toContain('connection refused')
  })
})
