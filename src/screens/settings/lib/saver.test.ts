import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildConfigBody, settingsSaver } from './saver'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('buildConfigBody', () => {
  it('expands a dotted key into the nested body the gateway deep-merges', () => {
    const { body, routed, unroutable } = buildConfigBody({ 'config.a.b': 1 })
    expect(body).toEqual({ config: { a: { b: 1 } } })
    expect(routed).toEqual(['config.a.b'])
    expect(unroutable).toEqual([])
  })

  it('merges sibling keys into one body', () => {
    const { body } = buildConfigBody({
      'config.terminal.timeout': 90,
      'config.terminal.backend': 'docker',
    })
    expect(body).toEqual({
      config: { terminal: { timeout: 90, backend: 'docker' } },
    })
  })

  it('routes a non-config key to unroutable rather than inventing a destination', () => {
    const { body, routed, unroutable } = buildConfigBody({
      'hermes.density': 'compact',
      'config.a': 1,
    })
    expect(body).toEqual({ config: { a: 1 } })
    expect(routed).toEqual(['config.a'])
    expect(unroutable).toEqual(['hermes.density'])
  })
})

describe('settingsSaver', () => {
  it('PUTs the config body through the dashboard proxy', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const outcome = await settingsSaver({ 'config.approvals.mode': 'auto' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/dashboard-proxy/api/config')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({
      config: { approvals: { mode: 'auto' } },
    })
    expect(outcome).toEqual({
      persisted: ['config.approvals.mode'],
      failed: [],
    })
  })

  it('reports every routed key as failed when the gateway answers 405', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Method Not Allowed', { status: 405 })),
    )

    const outcome = await settingsSaver({
      'config.approvals.mode': 'auto',
      'config.terminal.timeout': 90,
    })

    expect(outcome.persisted).toEqual([])
    expect(outcome.failed.map((f) => f.key).sort()).toEqual([
      'config.approvals.mode',
      'config.terminal.timeout',
    ])
    for (const failure of outcome.failed) {
      expect(failure.reason).toContain('405')
    }
  })

  it('does not reject when the network is down — it reports', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')))

    const outcome = await settingsSaver({ 'config.a': 1 })

    expect(outcome.persisted).toEqual([])
    expect(outcome.failed).toEqual([{ key: 'config.a', reason: 'fetch failed' }])
  })

  it('does not call the gateway when nothing is routable', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const outcome = await settingsSaver({ 'hermes.theme': 'matrix' })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(outcome.persisted).toEqual([])
    expect(outcome.failed).toEqual([
      { key: 'hermes.theme', reason: 'No persistence route for this key' },
    ])
  })

  /**
   * The saver used to mirror six localStorage keys to
   * /api/hermes-plugin/settings on a 2s debounce, fire-and-forget. Five of the
   * six were dead controls and the sixth sent a font family into `fontSize`.
   * Guard the deletion by source text: a re-added mirror would be invisible to
   * the behavioural tests above because it swallows all its own errors.
   */
  it('has no hermes-plugin mirror', () => {
    const src = readFileSync(new URL('./saver.ts', import.meta.url), 'utf8')
    expect(src.length).toBeGreaterThan(500)
    expect(src).not.toContain('hermes-plugin')
    expect(src).not.toContain('localStorage')
  })
})
