// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AgentWizard } from './agent-wizard'
import type { WizardStep } from '../types'
import type { ProfileDetail } from '@/server/profiles-browser'

const EDIT_NAME = 'custom-agent'

function detail(): ProfileDetail {
  return {
    name: EDIT_NAME,
    path: `/home/u/.hermes/profiles/${EDIT_NAME}`,
    active: false,
    hasEnv: false,
    config: {
      description: 'An agent that exists',
      system_prompt: 'You are helpful.',
      model: { default: 'claude-opus-4', provider: 'anthropic' },
      agent_ui: { glyph: 'CA', role: 'Reviewer', tags: ['review'] },
    },
  }
}

const roots: Array<ReturnType<typeof createRoot>> = []

/**
 * The wizard's queries are pre-seeded rather than fetched: `useProfilesList`
 * and the profile read both carry a 30s `staleTime`, so cached data means no
 * network at all and the seeding effect settles inside the first `act`.
 */
function renderWizard(
  props: Partial<React.ComponentProps<typeof AgentWizard>> = {},
  seedDetail = false,
): { container: HTMLElement; onClose: ReturnType<typeof vi.fn> } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['profiles', 'list'], {
    profiles: seedDetail ? [{ name: EDIT_NAME }] : [],
    activeProfile: undefined,
  })
  if (seedDetail) client.setQueryData(['profile-detail', EDIT_NAME], detail())

  const onClose = vi.fn()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <AgentWizard
          open
          onClose={onClose}
          onSuccess={() => {}}
          {...props}
        />
      </QueryClientProvider>,
    )
  })
  return { container, onClose }
}

function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    ;(document.activeElement ?? document).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    )
  })
}

function modal(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.wiz-modal')
  if (!el) throw new Error('wizard is not open')
  return el
}

function stepLabel(): string {
  const foot = modal().querySelector('.wiz-foot .lhs')
  return (foot?.textContent ?? '').replace(/\s+/g, ' ')
}

beforeEach(() => {
  // Nothing should reach the network; if it does, fail loudly rather than hang.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('unexpected fetch'))),
  )
})

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AgentWizard — focus management (P-16)', () => {
  it('moves focus into the dialog on open', () => {
    renderWizard()
    expect(modal().contains(document.activeElement)).toBe(true)
  })

  it('declares itself a modal dialog', () => {
    renderWizard()
    expect(modal().getAttribute('role')).toBe('dialog')
    expect(modal().getAttribute('aria-modal')).toBe('true')
  })

  it('does not let Tab walk out of the dialog', () => {
    renderWizard()
    const focusables = Array.from(
      modal().querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ),
    )
    focusables[focusables.length - 1].focus()
    press('Tab')
    expect(document.activeElement).toBe(focusables[0])

    press('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(focusables[focusables.length - 1])
  })

  it('restores focus to whatever opened it', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()

    renderWizard()
    expect(modal().contains(document.activeElement)).toBe(true)

    for (const root of roots.splice(0)) act(() => root.unmount())
    expect(document.activeElement).toBe(trigger)
  })
})

describe('AgentWizard — Escape (P-16)', () => {
  it('closes a clean draft on Escape', () => {
    const { onClose } = renderWizard()
    press('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('never silently discards a dirty draft — Escape raises the confirmation', () => {
    // Edit mode seeds a real profile, so the draft is dirty from the first frame.
    const { onClose } = renderWizard({ editProfileName: EDIT_NAME }, true)
    press('Escape')

    expect(onClose).not.toHaveBeenCalled()
    const confirm = document.querySelector('.pf-confirm')
    expect(confirm).not.toBeNull()
    expect(confirm!.textContent).toContain('Discard changes?')
  })

  it('a second Escape dismisses only the confirmation, leaving the wizard open', () => {
    const { onClose } = renderWizard({ editProfileName: EDIT_NAME }, true)
    press('Escape')
    press('Escape')

    expect(document.querySelector('.pf-confirm')).toBeNull()
    expect(document.querySelector('.wiz-modal')).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('AgentWizard — ?step= deep link', () => {
  it('opens at step 1 with no deep link', () => {
    renderWizard({ editProfileName: EDIT_NAME }, true)
    expect(stepLabel()).toContain('Step 1 / 9')
  })

  it('opens an edit at the requested step', () => {
    renderWizard({ editProfileName: EDIT_NAME, initialStep: 4 }, true)
    expect(stepLabel()).toContain('Step 4 / 9')
  })

  it('opens at the last step when asked for it', () => {
    renderWizard({ editProfileName: EDIT_NAME, initialStep: 9 }, true)
    expect(stepLabel()).toContain('Step 9 / 9')
  })

  it('seeds the draft as well as the step — the two do not fight', () => {
    const { container } = renderWizard(
      { editProfileName: EDIT_NAME, initialStep: 9 },
      true,
    )
    // Step 9 is the review screen; it can only show the seeded values if the
    // draft was seeded in the same pass that moved the step.
    expect(stepLabel()).toContain('Step 9 / 9')
    expect(container.textContent).toContain(EDIT_NAME)
  })

  it('ignores the deep-linked step for a create flow', () => {
    // Create locks the rail to completed steps; landing on step 5 of an empty
    // draft would bypass that lock, so the screen never passes it — and the
    // wizard refuses it even if a future caller does.
    renderWizard({ initialStep: 5 as WizardStep })
    expect(stepLabel()).toContain('Step 1 / 9')
  })

  it('does not drag the user back to ?step= after they navigate', () => {
    renderWizard({ editProfileName: EDIT_NAME, initialStep: 4 }, true)
    const back = Array.from(modal().querySelectorAll('button')).find(
      (b) => b.textContent.trim() === 'Back',
    )!
    act(() => {
      back.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(stepLabel()).toContain('Step 3 / 9')
  })
})
