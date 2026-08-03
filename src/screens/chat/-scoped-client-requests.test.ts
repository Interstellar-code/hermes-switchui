// @vitest-environment jsdom
// setSessionProfile() is a no-op without `window` — the ambient profile is a
// browser-only concept, so these must run in the DOM environment.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchSessions } from './chat-queries'
import { setSessionProfile } from '@/lib/session-scope'

/**
 * Client legs of rows 10 and 34: a threaded server parameter is decorative if
 * no caller emits it. These assert on the URL the browser actually requests.
 */

function stubFetch() {
  const urls: Array<string> = []
  const fetchMock = vi.fn((input: unknown) => {
    urls.push(String(input))
    return Promise.resolve(
      new Response(JSON.stringify({ sessions: [], data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return urls
}

beforeEach(() => {
  setSessionProfile(null)
})

afterEach(() => {
  setSessionProfile(null)
  vi.unstubAllGlobals()
})

describe('searchSessions client scoping (row 10)', () => {
  it('sends ?profile= when a profile is selected', async () => {
    const urls = stubFetch()
    setSessionProfile('neo')

    await searchSessions('needle')

    expect(urls[0]).toContain('profile=neo')
  })

  it('omits ?profile= entirely when unscoped', async () => {
    const urls = stubFetch()

    await searchSessions('needle')

    expect(urls[0]).toBe('/api/sessions?q=needle')
  })
})

describe('composer model catalog scoping (row 34)', () => {
  it('reads the scoped profile config, not the gateway-active one', async () => {
    const urls = stubFetch()
    setSessionProfile('neo')
    const { fetchModelCatalog } =
      await import('./components/v2/session-selectors-v2')

    await fetchModelCatalog()

    expect(urls[0]).toBe('/api/models?profile=neo')
  })

  it('stays byte-identical when unscoped', async () => {
    const urls = stubFetch()
    const { fetchModelCatalog } =
      await import('./components/v2/session-selectors-v2')

    await fetchModelCatalog()

    expect(urls[0]).toBe('/api/models')
  })
})
