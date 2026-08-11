// @vitest-environment jsdom
/**
 * The app-wide profile selector, and the feed that must agree with it.
 *
 * Only `fetch` is stubbed. The real `useProfilesList`, `useProfileScopeStatus`,
 * `useProfileSessionTotals`, `useSessionsFeed` and the real resolver all run, so
 * a dead request path, a cache-key regression or a precedence mistake fails here
 * instead of passing behind a module mock.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { renderToString } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NavProfileSelectorV2 } from './nav-profile-selector-v2'
import { newSessionSearch } from './primary-nav-v2'
import { Route as ChatSessionRoute } from '@/routes/chat/$sessionKey'
import { useSessionsFeed } from '@/screens/chat/sessions-feed'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'
import {
  UNSCOPED_PROFILE,
  getSessionProfile,
  profileBody,
  setSessionProfile,
  syncSessionProfileToPath,
} from '@/lib/session-scope'

const ROSTER = ['default', 'hermes-switch', 'morpheus', 'neo', 'trinity']

type StubOptions = {
  mode?: 'single' | 'multiplex' | 'unknown'
  servedProfiles?: Array<string> | null
  servingProfile?: string | null
  totals?: Record<string, number>
  totalsErrors?: Array<{ profile: string; error: string }>
}

function json(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
}

function sessionRow(key: string) {
  return {
    key,
    friendlyId: key,
    label: key,
    updatedAt: Date.now(),
    source: 'api_server',
    kind: 'chat',
  }
}

/** Mirrors the live multiplex gateway: all five profiles served. */
function stubFetch(opts: StubOptions = {}): Array<string> {
  const urls: Array<string> = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = String(input)
      urls.push(url)
      if (url.startsWith('/api/profiles/list')) {
        return json({
          profiles: ROSTER.map((name) => ({ name })),
          activeProfile: 'default',
        })
      }
      if (url.startsWith('/api/gateway-status')) {
        return json({
          scope: {
            mode: opts.mode ?? 'multiplex',
            servedProfiles:
              opts.servedProfiles === undefined ? ROSTER : opts.servedProfiles,
            servingProfile: opts.servingProfile ?? null,
            sessionCounts: {},
          },
        })
      }
      if (url.startsWith('/api/connection-status')) {
        return json({ capabilities: { sessions: true, dashboard: true } })
      }
      if (url.startsWith('/api/sessions?profile=all')) {
        return json({
          profile_totals: opts.totals ?? { default: 53, neo: 4 },
          errors: opts.totalsErrors ?? [],
        })
      }
      if (url.startsWith('/api/sessions')) {
        const profile = new URL(url, 'http://x').searchParams.get('profile')
        return json({
          sessions: [sessionRow(profile ? `${profile}-s1` : 'active-s1')],
        })
      }
      return json({})
    }),
  )
  return urls
}

let queryClient: QueryClient

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  // The device layer only applies on the profile-scoped route allowlist, which
  // `__root` arms on every navigation. Without this the selector renders
  // unscoped whatever the store holds — itself the correct behaviour off /chat.
  syncSessionProfileToPath('/chat/session-a')
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  setSessionProfile(null)
  useSessionsFilterStore.setState({ profile: UNSCOPED_PROFILE })
  syncSessionProfileToPath('/dashboard')
})

/** Open the menu and wait for the roster to land. */
async function openMenu() {
  fireEvent.click(screen.getByTestId('nav-profile-selector'))
  await waitFor(() =>
    expect(screen.getByTestId('nav-profile-option-trinity')).toBeTruthy(),
  )
}

describe('NavProfileSelectorV2', () => {
  it('renders a neutral placeholder before hydration, never a guessed name', () => {
    // `default` is a REAL profile under a multiplex gateway, which makes it the
    // most dangerous possible placeholder: it looks like "no selection" and
    // scopes like a selection. The server snapshot is the unscoped sentinel and
    // nothing else, so the hydrating render cannot paint a name the server
    // never rendered.
    useSessionsFilterStore.setState({ profile: 'default' })
    setSessionProfile('neo')
    stubFetch()

    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <NavProfileSelectorV2 />
      </QueryClientProvider>,
    )

    expect(html).toContain(UNSCOPED_PROFILE)
    expect(html).not.toContain('default')
    expect(html).not.toContain('neo')
  })

  it('writes the device layer, and the whole tab follows the pick', async () => {
    stubFetch()
    render(<NavProfileSelectorV2 />, { wrapper })
    expect(profileBody()).toEqual({})

    await openMenu()
    fireEvent.click(screen.getByTestId('nav-profile-option-trinity'))

    // One pick moves the persisted device layer, the resolver, and therefore
    // every query key and every write body — not just a list filter.
    expect(useSessionsFilterStore.getState().profile).toBe('trinity')
    expect(getSessionProfile()).toBe('trinity')
    expect(profileBody()).toEqual({ profile: 'trinity' })
    expect(screen.getByTestId('nav-profile-value').textContent).toBe('trinity')
  })

  it('carries the sessions feed to the picked profile', async () => {
    const urls = stubFetch()
    render(<NavProfileSelectorV2 />, { wrapper })
    await openMenu()
    fireEvent.click(screen.getByTestId('nav-profile-option-morpheus'))

    const { result } = renderHook(() => useSessionsFeed({ raw: true }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.items.length).toBe(1))
    expect(result.current.items[0].id).toBe('chat:morpheus-s1')
    expect(urls.some((u) => u.includes('profile=morpheus'))).toBe(true)
  })

  it('returns the tab to byte-identical unscoped behaviour', async () => {
    stubFetch()
    render(<NavProfileSelectorV2 />, { wrapper })
    await openMenu()
    fireEvent.click(screen.getByTestId('nav-profile-option-neo'))
    expect(profileBody()).toEqual({ profile: 'neo' })

    await openMenu()
    fireEvent.click(screen.getByTestId(`nav-profile-option-${UNSCOPED_PROFILE}`))

    expect(getSessionProfile()).toBeNull()
    expect(profileBody()).toEqual({})
  })

  it('treats "default" as a real profile, not as the unscoped sentinel', async () => {
    stubFetch()
    render(<NavProfileSelectorV2 />, { wrapper })
    await openMenu()
    fireEvent.click(screen.getByTestId('nav-profile-option-default'))

    expect(getSessionProfile()).toBe('default')
    expect(profileBody()).toEqual({ profile: 'default' })
  })

  it('disables a profile this gateway cannot serve, with the reason', async () => {
    // Refused at PICK time. The alternative is a message composed, sent, and
    // bounced by a 409 — after the user has done the work.
    stubFetch({ mode: 'multiplex', servedProfiles: ['default'] })
    render(<NavProfileSelectorV2 />, { wrapper })
    await openMenu()

    const row = await waitFor(() => {
      const el = screen.getByTestId('nav-profile-option-neo')
      expect(el.getAttribute('data-reachability')).toBe('not-served')
      return el
    })
    expect((row as HTMLButtonElement).disabled).toBe(true)
    expect(row.getAttribute('title')).toContain(
      'does not serve "neo"',
    )
    expect(row.getAttribute('aria-label')).toContain('profile unavailable')

    fireEvent.click(row)
    expect(useSessionsFilterStore.getState().profile).toBe(UNSCOPED_PROFILE)
    expect(getSessionProfile()).toBeNull()
  })

  it('keeps a servable profile selectable', async () => {
    stubFetch({ mode: 'multiplex', servedProfiles: ['default'] })
    render(<NavProfileSelectorV2 />, { wrapper })
    await openMenu()
    const row = await waitFor(() => {
      const el = screen.getByTestId('nav-profile-option-default')
      expect(el.getAttribute('data-reachability')).toBe('served')
      return el
    })
    expect((row as HTMLButtonElement).disabled).toBe(false)
  })

  it('renders a degraded profile as "!" and never as 0', async () => {
    // A profile whose state.db schema drifted reports an error, not a count.
    // Showing "0" for a profile holding 1500 sessions is a lie in the direction
    // of data loss.
    stubFetch({
      totals: { default: 53 },
      totalsErrors: [{ profile: 'neo', error: 'no such column: s.display_name' }],
    })
    render(<NavProfileSelectorV2 />, { wrapper })
    await openMenu()

    const row = await waitFor(() => {
      const el = screen.getByTestId('nav-profile-option-neo')
      expect(el.getAttribute('data-degraded')).toBe('true')
      return el
    })
    expect(row.textContent).toContain('!')
    expect(row.textContent).not.toContain('0')
    expect(row.getAttribute('title')).toContain('no such column: s.display_name')
  })

  it('shows the ?profile= pin and refuses a write the resolver would discard', () => {
    useSessionsFilterStore.setState({ profile: 'hermes-switch' })
    setSessionProfile('neo')
    stubFetch()
    render(<NavProfileSelectorV2 />, { wrapper })

    const trigger = screen.getByTestId('nav-profile-selector')
    expect(trigger.getAttribute('data-pinned')).toBe('url')
    expect(screen.getByTestId('nav-profile-value').textContent).toBe('neo')
    // No `onNewSessionInProfile` injected ⇒ nothing to offer, so the control is
    // dead rather than misleading.
    expect((trigger as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(trigger)
    expect(screen.queryByTestId('nav-profile-menu')).toBeNull()
    // The device selection underneath is untouched — no mirror, no clobber.
    expect(useSessionsFilterStore.getState().profile).toBe('hermes-switch')
    expect(getSessionProfile()).toBe('neo')
  })

  it('offers a NEW session in the picked profile instead of retargeting the open one', async () => {
    useSessionsFilterStore.setState({ profile: 'hermes-switch' })
    setSessionProfile('neo')
    stubFetch()
    const onNewSessionInProfile = vi.fn()
    render(
      <NavProfileSelectorV2 onNewSessionInProfile={onNewSessionInProfile} />,
      { wrapper },
    )

    await openMenu()
    fireEvent.click(screen.getByTestId('nav-profile-option-trinity'))

    expect(onNewSessionInProfile).toHaveBeenCalledWith('trinity')
    // The open session stays in the profile its `state.db` lives in.
    expect(getSessionProfile()).toBe('neo')
    expect(profileBody()).toEqual({ profile: 'neo' })
    expect(useSessionsFilterStore.getState().profile).toBe('hermes-switch')
  })

  it('never activates a profile gateway-wide', async () => {
    const urls = stubFetch()
    render(<NavProfileSelectorV2 />, { wrapper })
    await openMenu()
    fireEvent.click(screen.getByTestId('nav-profile-option-trinity'))

    // `/api/profiles/activate` rewrites ~/.hermes/active_profile and needs a
    // gateway restart. Scoping a tab is not that.
    expect(urls.some((u) => u.includes('/api/profiles/activate'))).toBe(false)
  })

  it('issues no background requests while the menu is closed', async () => {
    const urls = stubFetch()
    render(<NavProfileSelectorV2 />, { wrapper })
    await waitFor(() => expect(screen.getByTestId('nav-profile-selector')))
    // This control renders on every route; a closed menu must cost nothing.
    expect(urls).toEqual([])
  })

  it('keeps the profile visible in the collapsed rail', () => {
    useSessionsFilterStore.setState({ profile: 'neo' })
    stubFetch()
    const { rerender } = render(<NavProfileSelectorV2 collapsed />, { wrapper })

    const trigger = screen.getByTestId('nav-profile-selector')
    expect(trigger.getAttribute('title')).toContain('neo')
    expect(screen.getByTestId('nav-profile-marker')).toBeTruthy()

    useSessionsFilterStore.setState({ profile: UNSCOPED_PROFILE })
    rerender(<NavProfileSelectorV2 collapsed />)
    expect(screen.queryByTestId('nav-profile-marker')).toBeNull()
  })

  it('marks a pick that this route does not apply', () => {
    // Off the profile-scoped allowlist the resolver answers `null` by design.
    // The control shows the pick but does not claim it is in force.
    syncSessionProfileToPath('/dashboard')
    useSessionsFilterStore.setState({ profile: 'neo' })
    stubFetch()
    render(<NavProfileSelectorV2 />, { wrapper })

    expect(screen.getByTestId('nav-profile-value').textContent).toBe('neo')
    expect(
      screen.getByTestId('nav-profile-selector').getAttribute('data-applied'),
    ).toBe('false')
    expect(getSessionProfile()).toBeNull()
  })
})

// ── The feed reads the resolver, not the device layer ────────────────────────

describe('sessions feed precedence', () => {
  it('lists the URL-pinned profile even when the device layer disagrees', async () => {
    // The bug: a tab opened as /chat/<id>?profile=neo SENT to neo (every write
    // body spreads profileBody(), which reads the resolver) while the sidebar
    // listed whatever this device last picked. Header and list disagreed.
    const urls = stubFetch()
    useSessionsFilterStore.setState({ profile: 'trinity' })
    setSessionProfile('neo')

    const { result } = renderHook(() => useSessionsFeed({ raw: true }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.items.length).toBe(1))

    expect(result.current.items[0].id).toBe('chat:neo-s1')
    expect(urls.some((u) => u.includes('profile=neo'))).toBe(true)
    expect(urls.some((u) => u.includes('profile=trinity'))).toBe(false)
  })

  it('does not retarget an open session when the device layer switches', async () => {
    // Session ids are not unique across profiles: a chat that loses its profile
    // mid-thread keeps streaming, returns 200, and writes the rest of itself
    // into another profile's state.db. The URL layer outranking the device
    // layer is what makes that unexpressible.
    const urls = stubFetch()
    setSessionProfile('neo')
    const { result } = renderHook(() => useSessionsFeed({ raw: true }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.items.length).toBe(1))

    useSessionsFilterStore.getState().setProfile('trinity')

    expect(getSessionProfile()).toBe('neo')
    expect(profileBody()).toEqual({ profile: 'neo' })
    await waitFor(() => expect(result.current.items[0].id).toBe('chat:neo-s1'))
    expect(urls.some((u) => u.includes('profile=trinity'))).toBe(false)
  })

  it('stays unscoped, and byte-identical, with no pick anywhere', async () => {
    const urls = stubFetch()
    const { result } = renderHook(() => useSessionsFeed({ raw: true }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.items.length).toBe(1))
    expect(result.current.items[0].id).toBe('chat:active-s1')
    expect(urls.some((u) => u.includes('profile='))).toBe(false)
  })
})

// ── + New Session carries the scope ──────────────────────────────────────────

function buildRouter(initialEntry: string) {
  const rootRoute = createRootRoute({})
  const chatRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/chat/$sessionKey',
    // The subject under test: whatever the real route declares.
    validateSearch: ChatSessionRoute.options.validateSearch,
    search: ChatSessionRoute.options.search,
    component: () => null,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([chatRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  })
}

describe('new-session search', () => {
  it('spells the profile when scoped and says nothing when unscoped', () => {
    expect(newSessionSearch('neo')).toEqual({ profile: 'neo' })
    // `undefined` = unspecified, which is what the Link passes today. NOT
    // `{ profile: undefined }`, which is an explicit clear.
    expect(newSessionSearch(null)).toBeUndefined()
  })

  it('opens the new chat in the resolved profile', async () => {
    const router = buildRouter('/chat/session-a')
    await router.load()

    await router.navigate({
      to: '/chat/$sessionKey',
      params: { sessionKey: 'new' },
      search: newSessionSearch('trinity'),
    })
    await router.invalidate()

    expect(router.state.location.search).toEqual({ profile: 'trinity' })
  })

  it('leaves an unscoped install byte-identical', async () => {
    const router = buildRouter('/chat/session-a')
    await router.load()

    await router.navigate({
      to: '/chat/$sessionKey',
      params: { sessionKey: 'new' },
      search: newSessionSearch(null),
    })
    await router.invalidate()

    expect(router.state.location.searchStr).toBe('')
  })
})
