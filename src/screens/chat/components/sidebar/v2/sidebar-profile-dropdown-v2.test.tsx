// @vitest-environment jsdom
/**
 * Profile dropdown + profile-scoped sessions read.
 *
 * The feed half deliberately stubs only `fetch` — the real `useSessionsFeed`,
 * `useScopedChatSessionsFeed` and `fetchProfileSessions` all run, so a dead
 * request path or a cache-key regression fails here instead of passing behind
 * a module mock.
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarHeaderV2 } from './sidebar-header-v2'
import { SidebarProfileDropdownV2 } from './sidebar-profile-dropdown-v2'
import { chatQueryKeys } from '@/screens/chat/chat-queries'
import { ACTIVE_PROFILE, useSessionsFeed } from '@/screens/chat/sessions-feed'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'
import {
  UNSCOPED_PROFILE,
  getSessionProfile,
  profileBody,
  setSessionProfile,
  syncSessionProfileToPath,
} from '@/lib/session-scope'

const CLEAN_SINGLE = [{ profile: 'default', count: 53, error: null }]
const MULTI = [
  { profile: 'default', count: 53, error: null },
  { profile: 'hermes-switch', count: 1547, error: null },
]
const DEGRADED = [
  { profile: 'default', count: 53, error: null },
  { profile: 'neo', count: 0, error: 'no such column: s.display_name' },
]

beforeEach(() => {
  // The dropdown reads the RESOLVED profile, and the device layer only applies
  // on the chat surface — `__root` arms it on every navigation. Without this
  // the sidebar renders unscoped no matter what the store holds, which is
  // itself the correct behaviour off `/chat`.
  syncSessionProfileToPath('/chat/session-a')
})

afterEach(() => {
  cleanup()
  setSessionProfile(null)
  useSessionsFilterStore.setState({ profile: 'active' })
  syncSessionProfileToPath('/dashboard')
})

describe('SidebarProfileDropdownV2', () => {
  it('shares one sentinel with the sessions feed', () => {
    // Two spellings of "unscoped" would be a second source of truth by another
    // name: the feed would browse the active profile while the resolver
    // believed a profile named `active` was selected.
    expect(ACTIVE_PROFILE).toBe(UNSCOPED_PROFILE)
  })

  it('renders the trigger inside the sessions-panel header slot', () => {
    render(<SidebarHeaderV2 count={12} totals={MULTI} />)
    const header = screen.getByTestId('sessions-panel-header')
    const trigger = screen.getByTestId('sidebar-profile-trigger')
    expect(header.contains(trigger)).toBe(true)
    // `active` keeps today's presentation so single-profile users see no change
    expect(trigger.textContent).toContain('SESSIONS')
    expect(trigger.textContent).toContain('· 12')
  })

  it('hides the affordance for a single clean profile and renders the plain label', () => {
    render(<SidebarHeaderV2 count={12} totals={CLEAN_SINGLE} />)
    expect(screen.queryByTestId('sidebar-profile-trigger')).toBeNull()
    const header = screen.getByTestId('sessions-panel-header')
    expect(header.textContent).toContain('SESSIONS')
    expect(header.textContent).toContain('· 12')
  })

  it('shows a degraded profile as "!" with the upstream error, never as 0', () => {
    render(<SidebarProfileDropdownV2 totals={DEGRADED} count={53} />)
    fireEvent.click(screen.getByTestId('sidebar-profile-trigger'))
    const option = screen.getByTestId('profile-option-neo')
    expect(option.getAttribute('data-degraded')).toBe('true')
    expect(option.textContent).toContain('!')
    expect(option.textContent).not.toContain('0')
    expect(option.getAttribute('title')).toContain(
      'no such column: s.display_name',
    )
    expect(option.getAttribute('aria-label')).toBe(
      'neo profile unavailable: no such column: s.display_name',
    )
  })

  it('writes the picked profile to the filter store and reflects it in the trigger', () => {
    render(<SidebarProfileDropdownV2 totals={MULTI} count={53} />)
    fireEvent.click(screen.getByTestId('sidebar-profile-trigger'))
    fireEvent.click(screen.getByTestId('profile-option-hermes-switch'))
    expect(useSessionsFilterStore.getState().profile).toBe('hermes-switch')
    const trigger = screen.getByTestId('sidebar-profile-trigger')
    expect(trigger.textContent).toContain('hermes-switch')
    expect(trigger.textContent).toContain('· 1547')
    expect(trigger.textContent).not.toContain('SESSIONS')
  })

  it('sends the composer where the header says, not just the list', () => {
    // The bug: picking `hermes-switch` scoped the session list and nothing
    // else, so the next message still went to the gateway's active profile.
    // One pick must move the whole tab.
    render(<SidebarProfileDropdownV2 totals={MULTI} count={53} />)
    expect(profileBody()).toEqual({})

    fireEvent.click(screen.getByTestId('sidebar-profile-trigger'))
    fireEvent.click(screen.getByTestId('profile-option-hermes-switch'))

    expect(getSessionProfile()).toBe('hermes-switch')
    expect(profileBody()).toEqual({ profile: 'hermes-switch' })
  })

  it('picking "active" returns the tab to byte-identical unscoped behaviour', () => {
    render(<SidebarProfileDropdownV2 totals={MULTI} count={53} />)
    fireEvent.click(screen.getByTestId('sidebar-profile-trigger'))
    fireEvent.click(screen.getByTestId('profile-option-hermes-switch'))
    expect(profileBody()).toEqual({ profile: 'hermes-switch' })

    fireEvent.click(screen.getByTestId('sidebar-profile-trigger'))
    fireEvent.click(screen.getByTestId('profile-option-active'))

    expect(getSessionProfile()).toBeNull()
    expect(profileBody()).toEqual({})
    expect(screen.getByTestId('sidebar-profile-trigger').textContent).toContain(
      'SESSIONS',
    )
  })

  it('treats "default" as a real profile, not as the unscoped sentinel', () => {
    // Under a multiplex gateway `/p/default/health` answers 200, so `default`
    // is selectable and must scope like any other name.
    render(<SidebarProfileDropdownV2 totals={MULTI} count={53} />)
    fireEvent.click(screen.getByTestId('sidebar-profile-trigger'))
    fireEvent.click(screen.getByTestId('profile-option-default'))

    expect(getSessionProfile()).toBe('default')
    expect(profileBody()).toEqual({ profile: 'default' })
    expect(screen.getByTestId('sidebar-profile-trigger').textContent).toContain(
      'default',
    )
  })

  it('shows the ?profile= pin and refuses to offer a write that would lose', () => {
    // A session lives in exactly one profile's state.db, so the link that
    // opened this tab outranks a device-level pick. Rather than accept a
    // selection the resolver would discard — the two-picker bug in miniature —
    // the control renders the pinned profile and goes dead.
    useSessionsFilterStore.setState({ profile: 'hermes-switch' })
    setSessionProfile('neo')
    render(<SidebarProfileDropdownV2 totals={MULTI} count={53} />)

    const trigger = screen.getByTestId('sidebar-profile-trigger')
    expect(trigger.textContent).toContain('neo')
    expect(trigger.textContent).not.toContain('hermes-switch')
    expect((trigger as HTMLButtonElement).disabled).toBe(true)
    expect(trigger.getAttribute('data-pinned')).toBe('url')
    expect(trigger.getAttribute('title')).toContain('start a new chat')

    fireEvent.click(trigger)
    expect(screen.queryByTestId('sidebar-profile-menu')).toBeNull()
    // The device selection underneath is untouched — no mirror, no clobber.
    expect(useSessionsFilterStore.getState().profile).toBe('hermes-switch')
  })

  it('closes on Escape', () => {
    render(<SidebarProfileDropdownV2 totals={MULTI} count={53} />)
    fireEvent.click(screen.getByTestId('sidebar-profile-trigger'))
    expect(screen.getByTestId('sidebar-profile-menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('sidebar-profile-menu')).toBeNull()
  })
})

// ── Scoped read ───────────────────────────────────────────────────────────────

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

describe('profile-scoped sessions feed', () => {
  let urls: Array<string>
  let queryClient: QueryClient

  beforeEach(() => {
    urls = []
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        urls.push(String(input))
        const url = String(input)
        if (url.startsWith('/api/connection-status')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                capabilities: { sessions: true, dashboard: true },
              }),
          })
        }
        const profile = new URL(url, 'http://x').searchParams.get('profile')
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              sessions: [sessionRow(profile ? `${profile}-s1` : 'active-s1')],
            }),
        })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useSessionsFilterStore.setState({ profile: 'active' })
  })

  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }

  it('issues no scoped request while the profile is "active"', async () => {
    const { result } = renderHook(() => useSessionsFeed({ raw: true }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.items.length).toBe(1))
    expect(result.current.items[0].id).toBe('chat:active-s1')
    expect(urls.some((u) => u.includes('profile='))).toBe(false)
    expect(queryClient.getQueryData(chatQueryKeys.sessions)).not.toBeUndefined()
  })

  it('reads a foreign profile through its own key, leaving the shared mutation cache untouched', async () => {
    useSessionsFilterStore.setState({ profile: 'neo' })
    const { result } = renderHook(() => useSessionsFeed({ raw: true }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.items.length).toBe(1))
    expect(result.current.items[0].id).toBe('chat:neo-s1')

    expect(urls.some((u) => u.includes('profile=neo'))).toBe(true)
    // Scoped rows live under their own key…
    expect(
      queryClient.getQueryData(['sessions-feed', 'scoped-chat', 'neo']),
    ).not.toBeUndefined()
    // …and never in the shared cache every mutation helper writes into.
    expect(queryClient.getQueryData(chatQueryKeys.sessions)).toBeUndefined()
  })

  it('surfaces a failed scoped read through result.sources instead of an empty list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        if (String(input).startsWith('/api/connection-status')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                capabilities: { sessions: true, dashboard: true },
              }),
          })
        }
        return Promise.resolve({
          ok: false,
          status: 502,
          text: () => Promise.resolve('profile unreachable'),
        })
      }),
    )
    useSessionsFilterStore.setState({ profile: 'neo' })
    const { result } = renderHook(() => useSessionsFeed({ raw: true }), {
      wrapper,
    })
    await waitFor(() => {
      const chat = result.current.sources.find((s) => s.src === 'chat')
      expect(chat?.error).toBeTruthy()
    })
    const chat = result.current.sources.find((s) => s.src === 'chat')
    expect(chat?.available).toBe(true)
  })
})
