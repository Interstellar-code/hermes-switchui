import { describe, expect, it } from 'vitest'

import { buildTrustBoundaries, connectSatisfied } from './trust-boundaries'
import type {
  TrustBoundary,
  TrustBoundaryId,
  TrustBoundaryInput,
} from './trust-boundaries'

function input(
  overrides: Partial<TrustBoundaryInput> = {},
): TrustBoundaryInput {
  return {
    auth: { authenticated: true, authRequired: true },
    gateway: {
      capabilities: { health: true, chatCompletions: true, authError: false },
      gateway: {
        available: true,
        authError: false,
        url: 'http://127.0.0.1:8642',
      },
      claudeUrl: 'http://127.0.0.1:8642',
    },
    credentials: { ok: true, degraded: false, unreachable: [], statuses: [] },
    agentVersion: '2.5.34',
    activeProvider: null,
    ...overrides,
  }
}

function hop(
  boundaries: Array<TrustBoundary>,
  id: TrustBoundaryId,
): TrustBoundary {
  const found = boundaries.find((entry) => entry.id === id)
  if (!found) throw new Error(`no boundary ${id}`)
  return found
}

describe('buildTrustBoundaries', () => {
  it('always reports exactly three hops, in order', () => {
    expect(buildTrustBoundaries(input()).map((entry) => entry.id)).toEqual([
      'browser-ui',
      'ui-gateway',
      'gateway-provider',
    ])
  })
})

describe('browser → UI', () => {
  it('is satisfied when a password is required and this browser is signed in', () => {
    expect(hop(buildTrustBoundaries(input()), 'browser-ui').status).toBe('ok')
  })

  it('warns rather than passes when no password is set at all', () => {
    const boundary = hop(
      buildTrustBoundaries(
        input({ auth: { authenticated: true, authRequired: false } }),
      ),
      'browser-ui',
    )
    expect(boundary.status).toBe('warn')
    expect(boundary.note).toContain('HERMES_PASSWORD')
  })

  it('is unknown, never failed, before the check has answered', () => {
    expect(
      hop(buildTrustBoundaries(input({ auth: null })), 'browser-ui').status,
    ).toBe('unknown')
  })
})

describe('UI → gateway', () => {
  it('reports a 401 as a token mismatch and refuses to blame an outage', () => {
    // The whole reason `gateway.authError` exists. Reporting this as "not
    // responding" sends the user to restart a process that was never down.
    const boundary = hop(
      buildTrustBoundaries(
        input({
          gateway: {
            capabilities: { health: false, authError: true },
            gateway: {
              available: false,
              authError: true,
              url: 'http://127.0.0.1:8642',
            },
          },
        }),
      ),
      'ui-gateway',
    )
    expect(boundary.status).toBe('fail')
    expect(boundary.detail).toContain('401 Unauthorized')
    expect(boundary.note).toContain('The gateway is running')
    expect(boundary.note).toContain('API_SERVER_KEY')
    // Not a restart: the heal offered is to point at the right gateway.
    expect(boundary.heal).toBe('change-url')
  })

  it('reports a genuine outage as an outage, and offers to start the agent', () => {
    const boundary = hop(
      buildTrustBoundaries(
        input({
          gateway: {
            capabilities: { health: false, authError: false },
            gateway: {
              available: false,
              authError: false,
              url: 'http://127.0.0.1:8642',
            },
          },
        }),
      ),
      'ui-gateway',
    )
    expect(boundary.status).toBe('fail')
    expect(boundary.detail).toContain('Nothing answered')
    expect(boundary.heal).toBe('start-agent')
  })

  it('names the version and the serving profile when it is up', () => {
    const boundary = hop(
      buildTrustBoundaries(
        input({
          gateway: {
            capabilities: { health: true, authError: false },
            gateway: { available: true, authError: false, url: 'http://x:1' },
            scope: { mode: 'single', servingProfile: 'neo' },
          },
        }),
      ),
      'ui-gateway',
    )
    expect(boundary.status).toBe('ok')
    expect(boundary.detail).toContain('2.5.34')
    expect(boundary.detail).toContain('neo')
  })

  it('is unknown before the probe lands', () => {
    expect(
      hop(buildTrustBoundaries(input({ gateway: null })), 'ui-gateway').status,
    ).toBe('unknown')
  })
})

describe('gateway → provider', () => {
  it('never renders an unreadable store as an unconfigured one', () => {
    // The failure this whole layer exists to stop: telling a user to paste a
    // key they already have, and sending the paste to the unreconciled path.
    const boundary = hop(
      buildTrustBoundaries(
        input({
          activeProvider: 'anthropic',
          credentials: {
            ok: true,
            degraded: true,
            unreachable: ['/api/env (dashboard unreachable)'],
            statuses: [],
          },
        }),
      ),
      'gateway-provider',
    )
    expect(boundary.status).toBe('unknown')
    expect(boundary.detail).toContain('/api/env')
    expect(boundary.note).toContain('not the same as “no credential”')
  })

  it('names the store the gateway will actually read', () => {
    const boundary = hop(
      buildTrustBoundaries(
        input({
          activeProvider: 'anthropic',
          credentials: {
            ok: true,
            degraded: false,
            statuses: [
              {
                provider: 'anthropic',
                origin: 'env-file',
                effectiveOrigin: 'env-file',
              },
            ],
          },
        }),
      ),
      'gateway-provider',
    )
    expect(boundary.status).toBe('ok')
    expect(boundary.detail).toContain('the .env file')
  })

  it('warns when a higher-precedence copy shadows the one on screen', () => {
    const boundary = hop(
      buildTrustBoundaries(
        input({
          activeProvider: 'anthropic',
          credentials: {
            ok: true,
            degraded: false,
            statuses: [
              {
                provider: 'anthropic',
                origin: 'env-file',
                effectiveOrigin: 'pool',
                shadowedBy: 'pool',
                detail: 'Also set in pool, which wins on this provider shape.',
              },
            ],
          },
        }),
      ),
      'gateway-provider',
    )
    expect(boundary.status).toBe('warn')
    expect(boundary.detail).toContain('the auth.json credential pool')
    expect(boundary.detail).toContain('not from the .env file')
  })

  it('fails only when every readable store is definitively empty', () => {
    const boundary = hop(
      buildTrustBoundaries(
        input({
          activeProvider: 'anthropic',
          credentials: {
            ok: true,
            degraded: false,
            statuses: [
              {
                provider: 'anthropic',
                origin: 'none',
                effectiveOrigin: 'none',
              },
            ],
          },
        }),
      ),
      'gateway-provider',
    )
    expect(boundary.status).toBe('fail')
  })

  it('does not call a credential-free provider misconfigured', () => {
    // A local Ollama needs no credential at all, so an absent row is "not
    // applicable", not a finding.
    const boundary = hop(
      buildTrustBoundaries(
        input({
          activeProvider: 'ollama',
          credentials: { ok: true, statuses: [] },
        }),
      ),
      'gateway-provider',
    )
    expect(boundary.status).toBe('unknown')
    expect(boundary.note).toContain('need no credential at all')
  })

  it('says so plainly when no provider is active', () => {
    const boundary = hop(buildTrustBoundaries(input()), 'gateway-provider')
    expect(boundary.status).toBe('warn')
    expect(boundary.detail).toContain('No provider is active')
  })
})

describe('connectSatisfied', () => {
  it('keys only off the UI → gateway hop', () => {
    expect(connectSatisfied(buildTrustBoundaries(input()))).toBe(true)
    expect(
      connectSatisfied(
        buildTrustBoundaries(
          input({
            gateway: {
              capabilities: { health: false, authError: true },
              gateway: { available: false, authError: true },
            },
          }),
        ),
      ),
    ).toBe(false)
  })
})
