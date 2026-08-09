/**
 * The contract this module exists to keep is honesty about two things it does
 * not control: which provider is running, and whether that provider will
 * actually load. The gateway readiness read is the only source for the second,
 * it arrives through a proxy to a process that is routinely not running, and
 * the failure mode that matters is a step that claims "Ready" — or "broken" —
 * with no evidence either way.
 */
import { describe, expect, it } from 'vitest'

import { activeMemoryLabel, buildMemoryChoices } from './memory-choices'
import type { MemoryChoice } from './memory-choices'

/** A trimmed `GET /api/memory` body, in the shape the gateway really emits. */
const GATEWAY_BODY = {
  active: 'matrix-memory',
  providers: [
    { name: 'matrix-memory', status: 'ready', available: true },
    { name: 'holographic', status: 'ready', available: true },
    { name: 'mem0', status: 'needs_config', available: false },
    { name: 'byterover', status: 'unavailable', available: false },
    { name: 'honcho', status: 'missing', available: false },
  ],
  builtin_files: { memory: 1024, user: 512 },
}

function byId(choices: Array<MemoryChoice>, id: string): MemoryChoice {
  const found = choices.find((choice) => choice.id === id)
  if (!found) throw new Error(`no choice for ${id}`)
  return found
}

describe('buildMemoryChoices', () => {
  it('recommends matrix-memory, and only matrix-memory', () => {
    const choices = buildMemoryChoices({
      activeProvider: null,
      gatewayMemory: GATEWAY_BODY,
    })

    const recommended = choices.filter((choice) => choice.recommended)
    expect(recommended.map((choice) => choice.id)).toEqual(['matrix-memory'])

    const matrix = byId(choices, 'matrix-memory')
    // The whole basis of the recommendation: nothing to supply, nothing
    // remote. If either of these stops being true the recommendation is no
    // longer the honest one.
    expect(matrix.setup).toBe('none')
    expect(matrix.local).toBe(true)
    expect(matrix.requirement).toBeNull()
  })

  it('describes matrix-memory as local storage, never as a chat server', () => {
    // The name collides with the Matrix chat protocol, and a user who knows
    // that protocol will assume a homeserver. The description has to rule it
    // out, name the real engine, and never imply a network dependency.
    const matrix = byId(
      buildMemoryChoices({ activeProvider: null, gatewayMemory: null }),
      'matrix-memory',
    )
    expect(matrix.desc).toContain('SQLite')
    expect(matrix.desc).toContain('Mnemosyne')
    expect(matrix.desc).toContain('Unrelated to the Matrix chat protocol')
    expect(matrix.desc).not.toMatch(/homeserver|federat|sign in|API key/i)
  })

  it('reports every status as unknown when the readiness read is unavailable', () => {
    for (const payload of [
      null,
      undefined,
      'nope',
      42,
      [],
      { detail: 'Unauthorized' },
      { providers: 'not-an-array' },
      { providers: [null, {}, { name: 'mem0' }, { status: 'ready' }] },
      // A status word this UI does not know is no better than no row at all.
      { providers: [{ name: 'matrix-memory', status: 'sideways' }] },
    ]) {
      const choices = buildMemoryChoices({
        activeProvider: 'matrix-memory',
        gatewayMemory: payload,
      })
      expect(choices.length).toBeGreaterThan(0)
      expect(
        choices.every((choice) => choice.status === 'unknown'),
        `payload ${JSON.stringify(payload)} produced a non-unknown status`,
      ).toBe(true)
    }
  })

  it('maps the gateway status words onto the rendered ones', () => {
    const choices = buildMemoryChoices({
      activeProvider: null,
      gatewayMemory: GATEWAY_BODY,
    })
    expect(byId(choices, 'matrix-memory').status).toBe('ready')
    expect(byId(choices, 'mem0').status).toBe('needs-config')
    expect(byId(choices, 'byterover').status).toBe('unavailable')
    expect(byId(choices, 'honcho').status).toBe('missing')
    // Present in the catalog, absent from the gateway's list.
    expect(byId(choices, 'retaindb').status).toBe('unknown')
  })

  it('marks the active provider and orders it first', () => {
    const choices = buildMemoryChoices({
      activeProvider: 'mem0',
      gatewayMemory: GATEWAY_BODY,
    })
    expect(choices[0].id).toBe('mem0')
    expect(choices[0].isActive).toBe(true)
    expect(choices.filter((choice) => choice.isActive)).toHaveLength(1)
    expect(activeMemoryLabel(choices)).toBe('Mem0')
    // The recommendation follows the live one rather than displacing it.
    expect(choices[1].id).toBe('matrix-memory')
  })

  it('orders recommended, then zero-setup local, then the rest', () => {
    const choices = buildMemoryChoices({
      activeProvider: null,
      gatewayMemory: GATEWAY_BODY,
    })
    expect(choices[0].id).toBe('matrix-memory')
    expect(choices[1].id).toBe('holographic')
    expect(choices[1].setup).toBe('none')
    expect(choices[1].local).toBe(true)
    for (const choice of choices.slice(2)) {
      expect(choice.setup).not.toBe('none')
    }
  })

  it('gives every provider that needs something a requirement line', () => {
    const choices = buildMemoryChoices({
      activeProvider: null,
      gatewayMemory: GATEWAY_BODY,
    })
    for (const choice of choices) {
      if (choice.setup === 'none') {
        expect(choice.requirement, choice.id).toBeNull()
      } else {
        expect(choice.requirement, choice.id).toBeTruthy()
      }
    }
    expect(byId(choices, 'mem0').requirement).toMatch(/API key/)
    expect(byId(choices, 'byterover').requirement).toMatch(/command-line/)
    expect(byId(choices, 'honcho').requirement).toMatch(/sign-in/)
    expect(byId(choices, 'openviking').requirement).toMatch(/service/)
  })

  it('still shows a configured provider the catalog has never heard of', () => {
    // The bug the catalog widening fixed, at the choices layer: a machine
    // whose active provider is invisible in the one picker meant to show it.
    const choices = buildMemoryChoices({
      activeProvider: 'some-fork',
      gatewayMemory: { providers: [{ name: 'some-fork', status: 'ready' }] },
    })
    expect(choices[0]).toMatchObject({
      id: 'some-fork',
      label: 'some-fork',
      isActive: true,
      status: 'ready',
    })
    expect(activeMemoryLabel(choices)).toBe('some-fork')
  })

  it('marks nothing active when the config selects built-in files only', () => {
    for (const activeProvider of [null, '', '   ']) {
      const choices = buildMemoryChoices({
        activeProvider,
        gatewayMemory: GATEWAY_BODY,
      })
      expect(choices.some((choice) => choice.isActive)).toBe(false)
      expect(activeMemoryLabel(choices)).toBeNull()
      // And the recommendation leads instead.
      expect(choices[0].id).toBe('matrix-memory')
    }
  })
})
