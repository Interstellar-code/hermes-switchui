// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/require-await -- Response.json mocks intentionally match the async browser API. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { profileToRow } from '../profiles-screen'
import { ProfileCard } from './profile-card'
import { ProfileTableRow } from './profile-table-row'
import type { AgentRow } from '../profiles-screen'
import type { ProfileSummary } from '@/server/profiles-browser'

const globalWithAct = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
globalWithAct.IS_REACT_ACT_ENVIRONMENT = true

function scopeStatusResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response)
}

function summary(patch: Partial<ProfileSummary> = {}): ProfileSummary {
  return {
    name: 'custom-agent',
    path: '/home/u/.hermes/profiles/custom-agent',
    active: false,
    exists: true,
    skillCount: 4,
    sessionCount: 2,
    hasEnv: false,
    status: 'idle',
    ...patch,
  }
}

function row(patch: Partial<ProfileSummary> = {}): AgentRow {
  return profileToRow(summary(patch))
}

const roots: Array<ReturnType<typeof createRoot>> = []

/** Every render gets its own `QueryClient` — `useProfileScopeStatus` reads
 *  `['profiles', 'scope-status']` through `useQuery`, which throws without a
 *  provider in scope, and a fresh client per render keeps one test's scope
 *  data from leaking into the next via a shared cache. */
function withQueryClient(ui: React.ReactElement): React.ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  )
}

function render(ui: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(withQueryClient(ui))
  })
  return container
}

function renderRow(ui: React.ReactElement): HTMLElement {
  return render(<table><tbody>{ui}</tbody></table>)
}

/** Renders and flushes the scope-status fetch (a resolved promise plus a
 *  React state update), for tests that assert on its result. The update
 *  lands a tick after the mocked fetch's promise chain resolves, so this
 *  polls a few short `act` windows instead of assuming one is enough. */
async function renderAsync(ui: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(withQueryClient(ui))
  })
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
  }
  return container
}

async function renderRowAsync(ui: React.ReactElement): Promise<HTMLElement> {
  return renderAsync(<table><tbody>{ui}</tbody></table>)
}

function press(el: Element, key: string) {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )
  })
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  // Default: single-gateway mode, and the running gateway IS serving this
  // row's profile ('custom-agent', `row()`'s default name) — the quiet
  // common case (no scope badge). See use-profile-scope-status.ts.
  // Individual tests override this to exercise multiplex/not-served/unknown.
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      scopeStatusResponse({
        scope: {
          mode: 'single',
          servedProfiles: null,
          servingProfile: 'custom-agent',
          sessionCounts: {},
        },
      }),
    ),
  )
})

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ProfileCard — keyboard access (P-16)', () => {
  it('is focusable and exposes a button role', () => {
    const c = render(<ProfileCard agent={row()} onOpen={() => {}} />)
    const card = c.querySelector('.pf-card')!
    expect(card.getAttribute('role')).toBe('button')
    expect(card.getAttribute('tabindex')).toBe('0')
  })

  it('opens on Enter and on Space', () => {
    const onOpen = vi.fn()
    const c = render(<ProfileCard agent={row()} onOpen={onOpen} />)
    const card = c.querySelector('.pf-card')!
    press(card, 'Enter')
    press(card, ' ')
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('does not open on an unrelated key', () => {
    const onOpen = vi.fn()
    const c = render(<ProfileCard agent={row()} onOpen={onOpen} />)
    press(c.querySelector('.pf-card')!, 'a')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('does not double-fire when an action button is activated', () => {
    const onOpen = vi.fn()
    const onClone = vi.fn()
    const c = render(
      <ProfileCard agent={row()} onOpen={onOpen} onClone={onClone} />,
    )
    click(c.querySelector('button[aria-label^="Clone"]')!)
    expect(onClone).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('does not open the card when Space is pressed inside an action button', () => {
    const onOpen = vi.fn()
    const c = render(
      <ProfileCard agent={row()} onOpen={onOpen} onClone={() => {}} />,
    )
    press(c.querySelector('button[aria-label^="Clone"]')!, ' ')
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('ProfileCard — one honest status indicator (P-06/P-12)', () => {
  it('renders a single indicator for the active profile, not a dot plus a badge', () => {
    const c = render(<ProfileCard agent={row({ status: 'active' })} onOpen={() => {}} />)
    expect(c.querySelectorAll('.pf-status')).toHaveLength(1)
    expect(c.querySelector('.pf-in-use-badge')).toBeNull()
    expect(c.textContent).toContain('in use')
  })

  it('renders draft and idle states from the derived status', () => {
    const draft = render(<ProfileCard agent={row({ status: 'draft' })} onOpen={() => {}} />)
    expect(draft.querySelector('.pf-status')?.className).toContain('draft')
  })
})

describe('ProfileCard — surfaced signals (G-02)', () => {
  it('shows skill and session counts and a never-run last-used', () => {
    const c = render(<ProfileCard agent={row()} onOpen={() => {}} />)
    expect(c.textContent).toContain('4 skills')
    expect(c.textContent).toContain('2 sessions')
    expect(c.textContent).toContain('never run')
  })

  it('singularises the counts', () => {
    const c = render(
      <ProfileCard agent={row({ skillCount: 1, sessionCount: 1 })} onOpen={() => {}} />,
    )
    expect(c.textContent).toContain('1 skill')
    expect(c.textContent).not.toContain('1 skills')
    expect(c.textContent).toContain('1 session')
  })

  it('renders lastRunAt as seconds-since-epoch', () => {
    const anHourAgo = Math.floor(Date.now() / 1000) - 3600
    const c = render(<ProfileCard agent={row({ lastRunAt: anHourAgo })} onOpen={() => {}} />)
    expect(c.textContent).toContain('1h ago')
  })

  it('shows the .env badge only when the profile has one', () => {
    expect(render(<ProfileCard agent={row()} onOpen={() => {}} />)
      .querySelector('.pf-env-badge')).toBeNull()
    expect(render(<ProfileCard agent={row({ hasEnv: true })} onOpen={() => {}} />)
      .querySelector('.pf-env-badge')).not.toBeNull()
  })
})

describe('ProfileCard — activate from the grid (P-05)', () => {
  it('renders an Activate button when the screen supplies the callback', () => {
    const onActivate = vi.fn()
    const c = render(
      <ProfileCard agent={row()} onOpen={() => {}} onActivate={onActivate} />,
    )
    click(c.querySelector('button[aria-label^="Activate"]')!)
    expect(onActivate).toHaveBeenCalledWith('custom-agent')
  })

  it('renders no Activate button when the screen withholds the callback', () => {
    const c = render(<ProfileCard agent={row({ status: 'active' })} onOpen={() => {}} />)
    expect(c.querySelector('button[aria-label^="Activate"]')).toBeNull()
  })
})

describe('ProfileTableRow — keyboard access + built-in lock (P-07/P-16)', () => {
  it('is focusable and keeps the implicit row role', () => {
    const c = renderRow(<ProfileTableRow agent={row()} onOpen={() => {}} />)
    const tr = c.querySelector('tr')!
    expect(tr.getAttribute('tabindex')).toBe('0')
    expect(tr.getAttribute('role')).toBeNull()
  })

  it('opens on Enter and Space', () => {
    const onOpen = vi.fn()
    const c = renderRow(<ProfileTableRow agent={row()} onOpen={onOpen} />)
    press(c.querySelector('tr')!, 'Enter')
    press(c.querySelector('tr')!, ' ')
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('does not double-fire when a row action is clicked', () => {
    const onOpen = vi.fn()
    const onEdit = vi.fn()
    const c = renderRow(
      <ProfileTableRow agent={row()} onOpen={onOpen} onEdit={onEdit} />,
    )
    click(c.querySelector('button[aria-label^="Edit"]')!)
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('shows the lock affordance for a built-in row', () => {
    const c = renderRow(
      <ProfileTableRow
        agent={row({ name: 'neo' })}
        onOpen={() => {}}
        onEdit={() => {}}
        onClone={() => {}}
      />,
    )
    expect(c.querySelector('.pf-tbl-lock')).not.toBeNull()
    expect(c.querySelector('button[aria-label^="Rename"]')).toBeNull()
    expect(c.querySelector('button[aria-label^="Delete"]')).toBeNull()
    expect(c.querySelector('button[aria-label^="Edit"]')).not.toBeNull()
    expect(c.querySelector('button[aria-label^="Clone"]')).not.toBeNull()
  })

  it('shows no lock for a user-created row with the full action set', () => {
    const c = renderRow(
      <ProfileTableRow
        agent={row()}
        onOpen={() => {}}
        onEdit={() => {}}
        onRename={() => {}}
        onClone={() => {}}
        onDelete={() => {}}
      />,
    )
    expect(c.querySelector('.pf-tbl-lock')).toBeNull()
    expect(c.querySelector('button[aria-label^="Rename"]')).not.toBeNull()
    expect(c.querySelector('button[aria-label^="Delete"]')).not.toBeNull()
  })
})

describe('ProfileCard / ProfileTableRow — live-gateway scope badge (G-05)', () => {
  it('renders no badge in single-gateway mode — the quiet, common case', async () => {
    const card = await renderAsync(<ProfileCard agent={row()} onOpen={() => {}} />)
    expect(card.querySelector('.pf-scope-badge')).toBeNull()

    const tr = await renderRowAsync(<ProfileTableRow agent={row()} onOpen={() => {}} />)
    expect(tr.querySelector('.pf-scope-badge')).toBeNull()
  })

  it('flags a profile a multiplexed gateway does not serve, on both the card and the row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        scopeStatusResponse({
          scope: {
            mode: 'multiplex',
            servedProfiles: ['someone-else'],
            sessionCounts: {},
          },
        }),
      ),
    )
    const card = await renderAsync(<ProfileCard agent={row()} onOpen={() => {}} />)
    const cardBadge = card.querySelector('.pf-scope-badge')
    expect(cardBadge).not.toBeNull()
    const cardBadgeEl = cardBadge as Element
    expect(cardBadgeEl.className).toContain('pf-scope-badge--not-served')
    expect(cardBadgeEl.textContent.toLowerCase()).toContain('not served')

    const tr = await renderRowAsync(<ProfileTableRow agent={row()} onOpen={() => {}} />)
    const rowBadge = tr.querySelector('.pf-scope-badge')
    expect(rowBadge).not.toBeNull()
    expect((rowBadge as Element).className).toContain('pf-scope-badge--not-served')
  })

  it('renders no badge for a profile a multiplexed gateway does serve', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        scopeStatusResponse({
          scope: {
            mode: 'multiplex',
            servedProfiles: ['custom-agent'],
            sessionCounts: {},
          },
        }),
      ),
    )
    const card = await renderAsync(<ProfileCard agent={row()} onOpen={() => {}} />)
    expect(card.querySelector('.pf-scope-badge')).toBeNull()
  })

  it('fails closed to a distinct "unknown" badge — never a silent "served" — when the probe errors', async () => {
    vi.stubGlobal('fetch', vi.fn(() => scopeStatusResponse({ error: 'boom' }, false)))
    const card = await renderAsync(<ProfileCard agent={row()} onOpen={() => {}} />)
    const badge = card.querySelector('.pf-scope-badge')
    expect(badge).not.toBeNull()
    const badgeEl = badge as Element
    expect(badgeEl.className).toContain('pf-scope-badge--unknown')
    expect(badgeEl.className).not.toContain('pf-scope-badge--not-served')
    expect(badgeEl.textContent.toLowerCase()).toContain('unknown')
  })

  it('flags a single-gateway mismatch — Selected vs Serving (W3 audit item 1) — on both card and row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        scopeStatusResponse({
          scope: {
            mode: 'single',
            servedProfiles: null,
            servingProfile: 'hermes-switch',
            sessionCounts: {},
          },
        }),
      ),
    )
    // `row()` defaults to profileName 'custom-agent' — NOT what the (single)
    // gateway is currently serving ('hermes-switch').
    const card = await renderAsync(<ProfileCard agent={row()} onOpen={() => {}} />)
    const cardBadge = card.querySelector('.pf-scope-badge')
    expect(cardBadge).not.toBeNull()
    expect((cardBadge as Element).className).toContain('pf-scope-badge--not-served')
    expect((cardBadge as Element).textContent.toLowerCase()).toContain('not served')
    expect((cardBadge as HTMLElement).title).toContain('hermes-switch')

    const tr = await renderRowAsync(<ProfileTableRow agent={row()} onOpen={() => {}} />)
    const rowBadge = tr.querySelector('.pf-scope-badge')
    expect(rowBadge).not.toBeNull()
    expect((rowBadge as Element).className).toContain('pf-scope-badge--not-served')
  })

  it('renders no badge for a single-gateway profile the gateway IS running', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        scopeStatusResponse({
          scope: {
            mode: 'single',
            servedProfiles: null,
            servingProfile: 'custom-agent',
            sessionCounts: {},
          },
        }),
      ),
    )
    const card = await renderAsync(<ProfileCard agent={row()} onOpen={() => {}} />)
    expect(card.querySelector('.pf-scope-badge')).toBeNull()
  })
})
