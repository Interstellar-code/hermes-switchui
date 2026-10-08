// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'

import { ChatComposerShadcn, ReasoningToggle } from './chat-composer-shadcn'
import type { ReactNode } from 'react'
import { TooltipProvider } from '@/components/shadcn/ui/tooltip'
import { useSessionReasoningStore } from '@/stores/session-reasoning-store'
import { useChatSettingsStore } from '@/hooks/use-chat-settings'

/**
 * The composer's per-session reasoning toggle, exercised through the real
 * extracted component the toolbar renders (`ReasoningToggle`) with the real
 * stores and real localStorage — nothing mocked.
 */

function setGlobalShowReasoningBlocks(value: boolean) {
  useChatSettingsStore.setState({
    settings: {
      ...useChatSettingsStore.getState().settings,
      showReasoningBlocks: value,
    },
  })
}

function renderToggle(sessionKey?: string) {
  return render(
    <TooltipProvider>
      <ReasoningToggle sessionKey={sessionKey} />
    </TooltipProvider>,
  )
}

/** jsdom has no matchMedia; the composer's ContextBar calls it on mount. */
function ensureMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

beforeEach(() => {
  window.localStorage.clear()
  ensureMatchMedia()
  useSessionReasoningStore.setState({ overrides: {} })
  setGlobalShowReasoningBlocks(false)
  // The real composer mounts the slash-command picker, which fetches its
  // catalog on mount. Nothing else about the composer is stubbed.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ReasoningToggle', () => {
  it('renders nothing on a new unsaved chat (no session key)', () => {
    const { container } = renderToggle(undefined)
    expect(container.firstChild).toBeNull()
  })

  it('reflects the global default while no override is set', () => {
    setGlobalShowReasoningBlocks(true)
    renderToggle('chat:t1')
    const button = screen.getByRole('button', {
      name: 'Hide reasoning (this chat)',
    })
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('clicking flips aria-pressed and writes the override for that session', () => {
    renderToggle('chat:t1')
    const button = screen.getByRole('button', {
      name: 'Show reasoning (this chat)',
    })
    expect(button.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(button)
    expect(useSessionReasoningStore.getState().overrides['chat:t1']).toBe(true)

    const pressed = screen.getByRole('button', {
      name: 'Hide reasoning (this chat)',
    })
    expect(pressed.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(pressed)
    expect(useSessionReasoningStore.getState().overrides['chat:t1']).toBe(false)
    expect(
      screen
        .getByRole('button', { name: 'Show reasoning (this chat)' })
        .getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('writes the override only for the rendered session key', () => {
    renderToggle('chat:t1')
    fireEvent.click(
      screen.getByRole('button', { name: 'Show reasoning (this chat)' }),
    )

    expect(useSessionReasoningStore.getState().overrides).toEqual({
      'chat:t1': true,
    })
  })
})

function renderComposer(sessionKey?: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
  return render(
    createElement(ChatComposerShadcn, {
      onSubmit: vi.fn(),
      isLoading: false,
      disabled: false,
      sessionKey,
    }),
    { wrapper },
  )
}

const openMobileMenu = () =>
  fireEvent.click(screen.getByTestId('composer-mobile-actions-trigger'))

const mobileReasoningItem = () =>
  screen.queryByTestId('mobile-action-reasoning')

/**
 * The mobile surface: the REAL composer mounted with its REAL
 * `mobileActions` list, rendered through the real `ComposerMobileActionsMenu`
 * popover. Only the slash-command catalog fetch is stubbed (it is a network
 * call the composer makes on mount regardless of this toggle).
 */
describe('composer mobile reasoning action', () => {
  it('offers no reasoning item on a new unsaved chat (no session key)', () => {
    renderComposer(undefined)
    openMobileMenu()

    // The menu itself opened — the reasoning entry is the thing missing.
    expect(screen.getByTestId('mobile-action-attach')).toBeDefined()
    expect(mobileReasoningItem()).toBeNull()
  })

  it('labels the item from the global default and writes the override on click', () => {
    renderComposer('chat:t1')
    openMobileMenu()

    const item = mobileReasoningItem()
    expect(item?.textContent).toContain('Show reasoning (this chat)')
    expect(item?.className).not.toContain('bg-[var(--theme-accent)]')

    fireEvent.click(item as HTMLElement)
    expect(useSessionReasoningStore.getState().overrides['chat:t1']).toBe(true)

    // Effective value is now on, so the menu offers the reverse action.
    openMobileMenu()
    expect(mobileReasoningItem()?.textContent).toContain(
      'Hide reasoning (this chat)',
    )
  })

  it('marks the item active and labelled for the global default turned on', () => {
    setGlobalShowReasoningBlocks(true)
    renderComposer('chat:t1')
    openMobileMenu()

    const item = mobileReasoningItem()
    expect(item?.textContent).toContain('Hide reasoning (this chat)')
    expect(item?.className).toContain('bg-[var(--theme-accent)]')
  })

  it('lets a stored override win over the global default in the menu too', () => {
    setGlobalShowReasoningBlocks(true)
    useSessionReasoningStore.getState().setOverride('chat:t1', false)
    renderComposer('chat:t1')
    openMobileMenu()

    expect(mobileReasoningItem()?.textContent).toContain(
      'Show reasoning (this chat)',
    )

    fireEvent.click(mobileReasoningItem() as HTMLElement)
    expect(useSessionReasoningStore.getState().overrides['chat:t1']).toBe(true)
  })

  it('scopes the write to the rendered session key only', () => {
    useSessionReasoningStore.getState().setOverride('chat:other', true)
    renderComposer('chat:t1')
    openMobileMenu()
    fireEvent.click(mobileReasoningItem() as HTMLElement)

    expect(useSessionReasoningStore.getState().overrides).toEqual({
      'chat:other': true,
      'chat:t1': true,
    })
  })
})
