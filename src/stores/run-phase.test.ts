import { describe, expect, it } from 'vitest'

import {
  
  isRunPhaseBusy,
  isRunPhaseTerminal,
  reduceRunPhase
} from './run-phase'
import type {RunPhase} from './run-phase';

describe('reduceRunPhase', () => {
  describe('happy paths', () => {
    it('idle → sending via active-send-set', () => {
      expect(reduceRunPhase('idle', 'sending', 'active-send-set')).toBe('sending')
    })

    it('sending → streaming via sse-event', () => {
      expect(reduceRunPhase('sending', 'streaming', 'sse-event')).toBe(
        'streaming',
      )
    })

    it('streaming → streaming via sse-event (idempotent deltas)', () => {
      expect(reduceRunPhase('streaming', 'streaming', 'sse-event')).toBe(
        'streaming',
      )
    })

    it('streaming → complete via sse-complete', () => {
      expect(reduceRunPhase('streaming', 'complete', 'sse-complete')).toBe(
        'complete',
      )
    })

    it('streaming → error via sse-error', () => {
      expect(reduceRunPhase('streaming', 'error', 'sse-error')).toBe('error')
    })

    it('idle → streaming via liveness-snapshot (Track 1.2 recovery)', () => {
      expect(
        reduceRunPhase('idle', 'streaming', 'liveness-snapshot'),
      ).toBe('streaming')
    })

    it('streaming → idle via liveness-clear', () => {
      expect(reduceRunPhase('streaming', 'idle', 'liveness-clear')).toBe('idle')
    })

    it('streaming → idle via stream-finish', () => {
      expect(reduceRunPhase('streaming', 'idle', 'stream-finish')).toBe('idle')
    })
  })

  describe('F2 fence guard — predicate-clear can NEVER set busy', () => {
    it('rejects predicate-clear → streaming', () => {
      expect(
        reduceRunPhase('idle', 'streaming', 'predicate-clear'),
      ).toBeNull()
    })

    it('rejects predicate-clear → sending', () => {
      expect(reduceRunPhase('idle', 'sending', 'predicate-clear')).toBeNull()
    })

    it('allows predicate-clear → interrupted (the only valid busy-adjacent target)', () => {
      expect(
        reduceRunPhase('idle', 'interrupted', 'predicate-clear'),
      ).toBe('interrupted')
    })

    it('allows predicate-clear → complete (clear path)', () => {
      expect(reduceRunPhase('idle', 'complete', 'predicate-clear')).toBe(
        'complete',
      )
    })

    it('allows predicate-clear → idle (clear path)', () => {
      expect(reduceRunPhase('idle', 'idle', 'predicate-clear')).toBe('idle')
    })

    it('rejects predicate-clear → error (not a valid target from predicate)', () => {
      expect(reduceRunPhase('idle', 'error', 'predicate-clear')).toBeNull()
    })
  })

  describe('illegal transitions', () => {
    it('rejects sse-event → interrupted (history-shaped terminal)', () => {
      expect(
        reduceRunPhase('streaming', 'interrupted', 'sse-event'),
      ).toBeNull()
    })

    it('rejects liveness-clear → streaming (no authority for live)', () => {
      expect(
        reduceRunPhase('idle', 'streaming', 'liveness-clear'),
      ).toBeNull()
    })

    it('rejects liveness-clear → sending (no authority for live)', () => {
      expect(reduceRunPhase('idle', 'sending', 'liveness-clear')).toBeNull()
    })

    it('rejects stream-finish → streaming (terminal reset cannot re-arm)', () => {
      expect(
        reduceRunPhase('error', 'streaming', 'stream-finish'),
      ).toBeNull()
    })

    it('rejects active-send-set → streaming (active-send is sending, not streaming)', () => {
      expect(
        reduceRunPhase('idle', 'streaming', 'active-send-set'),
      ).toBeNull()
    })
  })

  describe('idempotence', () => {
    it('returns current when same phase requested', () => {
      expect(
        reduceRunPhase('streaming', 'streaming', 'sse-event'),
      ).toBe('streaming')
    })
  })
})

describe('isRunPhaseBusy', () => {
  it('returns true for sending and streaming', () => {
    expect(isRunPhaseBusy('sending')).toBe(true)
    expect(isRunPhaseBusy('streaming')).toBe(true)
  })

  it('returns false for terminal states', () => {
    const terminals: Array<RunPhase> = ['idle', 'complete', 'error', 'interrupted']
    for (const phase of terminals) {
      expect(isRunPhaseBusy(phase)).toBe(false)
    }
  })
})

describe('isRunPhaseTerminal', () => {
  it('returns true for idle, complete, error, interrupted', () => {
    expect(isRunPhaseTerminal('idle')).toBe(true)
    expect(isRunPhaseTerminal('complete')).toBe(true)
    expect(isRunPhaseTerminal('error')).toBe(true)
    expect(isRunPhaseTerminal('interrupted')).toBe(true)
  })

  it('returns false for sending and streaming', () => {
    expect(isRunPhaseTerminal('sending')).toBe(false)
    expect(isRunPhaseTerminal('streaming')).toBe(false)
  })
})
