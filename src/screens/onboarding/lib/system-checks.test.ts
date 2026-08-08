import { describe, expect, it } from 'vitest'

import { buildSystemChecks } from './system-checks'

const NOT_FAIL = new Set(['ok', 'warn', 'unknown'])

describe('buildSystemChecks — degradation, never a false fail', () => {
  it('every input null degrades every check to unknown', () => {
    const checks = buildSystemChecks({
      gateway: null,
      metrics: null,
      agentVersion: null,
      update: null,
    })
    expect(checks.length).toBeGreaterThan(0)
    for (const check of checks) {
      expect(check.status).not.toBe('fail')
    }
    // The boolean-capability checks specifically have nothing to go on, so
    // they must land on 'unknown', not silently pass as 'ok'.
    const gateway = checks.find((c) => c.id === 'gateway')
    expect(gateway?.status).toBe('unknown')
  })

  it('all inputs undefined (no fields passed) also degrades cleanly', () => {
    const checks = buildSystemChecks({})
    for (const check of checks) {
      expect(NOT_FAIL.has(check.status)).toBe(true)
    }
  })

  it('a 401 shape ({ error: "Unauthorized" }) degrades to unknown, not fail', () => {
    const checks = buildSystemChecks({
      gateway: { error: 'Unauthorized' },
      metrics: { error: 'Unauthorized' },
      agentVersion: { error: 'Unauthorized' },
      update: { error: 'Unauthorized' },
    })
    for (const check of checks) {
      expect(check.status).not.toBe('fail')
    }
  })

  it('a 404 shape (empty object) degrades to unknown, not fail', () => {
    const checks = buildSystemChecks({
      gateway: {},
      metrics: {},
      agentVersion: {},
      update: {},
    })
    for (const check of checks) {
      expect(check.status).not.toBe('fail')
    }
  })

  it('an array where an object was expected does not throw and does not fail', () => {
    expect(() =>
      buildSystemChecks({
        gateway: [1, 2, 3],
        metrics: 'not an object',
        agentVersion: 42,
        update: true,
      }),
    ).not.toThrow()
    const checks = buildSystemChecks({
      gateway: [1, 2, 3],
      metrics: 'not an object',
      agentVersion: 42,
      update: true,
    })
    for (const check of checks) {
      expect(check.status).not.toBe('fail')
    }
  })
})

describe('buildSystemChecks — a real answer that says broken is a fail', () => {
  it('gateway.capabilities.health === false is a real fail', () => {
    const checks = buildSystemChecks({
      gateway: { capabilities: { health: false } },
    })
    expect(checks.find((c) => c.id === 'gateway')?.status).toBe('fail')
  })

  it('gateway.capabilities.chatCompletions === false is a real fail', () => {
    const checks = buildSystemChecks({
      gateway: { capabilities: { chatCompletions: false } },
    })
    expect(checks.find((c) => c.id === 'chat-completions')?.status).toBe('fail')
  })
})

describe('buildSystemChecks — healthy inputs', () => {
  it('reports ok across the board for a fully healthy snapshot', () => {
    const checks = buildSystemChecks({
      gateway: {
        capabilities: {
          health: true,
          chatCompletions: true,
          models: true,
          sessions: true,
          skills: true,
          memory: true,
          config: true,
          jobs: true,
        },
      },
      metrics: {
        cpu: { loadPercent: 20 },
        memory: { usedPercent: 40 },
        disk: { usedPercent: 55 },
        hermes: { dashboard: true },
      },
      agentVersion: { version: '1.2.3' },
      update: { ok: true, updateAvailable: false },
    })

    expect(checks.find((c) => c.id === 'gateway')?.status).toBe('ok')
    expect(checks.find((c) => c.id === 'chat-completions')?.status).toBe('ok')
    expect(checks.find((c) => c.id === 'models')?.status).toBe('ok')
    expect(checks.find((c) => c.id === 'dashboard')?.status).toBe('ok')
    expect(checks.find((c) => c.id === 'cpu')?.status).toBe('ok')
    expect(checks.find((c) => c.id === 'memory')?.status).toBe('ok')
    expect(checks.find((c) => c.id === 'disk')?.status).toBe('ok')
    expect(checks.find((c) => c.id === 'agent-version')?.status).toBe('ok')
    expect(checks.find((c) => c.id === 'update-available')?.status).toBe('ok')

    const capabilities = checks.find((c) => c.id === 'capabilities')
    expect(capabilities?.status).toBe('ok')
    expect(capabilities?.detail).toContain('5 of 6')
  })

  it('warns rather than fails on high resource usage', () => {
    const checks = buildSystemChecks({
      metrics: { cpu: { loadPercent: 95 } },
    })
    expect(checks.find((c) => c.id === 'cpu')?.status).toBe('warn')
  })

  it('warns rather than fails when an update is available', () => {
    const checks = buildSystemChecks({
      update: { ok: true, updateAvailable: true },
    })
    expect(checks.find((c) => c.id === 'update-available')?.status).toBe('warn')
  })
})
