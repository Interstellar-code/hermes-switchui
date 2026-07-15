// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { fireEvent } from '@testing-library/dom'
import { DelegationDetailModal } from './delegation-detail-modal'

const useDelegationMessagesMock = vi.fn()

vi.mock('../../hooks/use-delegations', () => ({
  useDelegationMessages: (...args: Array<unknown>) => useDelegationMessagesMock(...args),
}))

vi.mock('./chat-tab-views-v2', () => ({
  ToolTabView: ({ messages }: { messages: Array<unknown> }) => (
    <div data-testid="tool-tab-view">{messages.length} messages</div>
  ),
}))

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function renderInto(ui: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  act(() => {
    createRoot(container).render(ui)
  })
  return container
}

describe('DelegationDetailModal', () => {
  it('renders nothing when childSessionId is null', () => {
    useDelegationMessagesMock.mockReturnValue({ messages: [], isLoading: false, error: null })
    renderInto(<DelegationDetailModal childSessionId={null} onClose={() => {}} />)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders the ToolTabView with mocked messages when open', () => {
    useDelegationMessagesMock.mockReturnValue({
      messages: [{ role: 'assistant' }, { role: 'user' }],
      isLoading: false,
      error: null,
    })
    renderInto(<DelegationDetailModal childSessionId="child-1" onClose={() => {}} />)
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(document.body.querySelector('[data-testid="tool-tab-view"]')?.textContent).toBe(
      '2 messages',
    )
  })

  it('closes on backdrop click and on close button click', () => {
    useDelegationMessagesMock.mockReturnValue({ messages: [], isLoading: false, error: null })
    const onClose = vi.fn()
    renderInto(<DelegationDetailModal childSessionId="child-1" onClose={onClose} />)

    fireEvent.click(document.body.querySelector('[aria-label="Close"]')!)
    expect(onClose).toHaveBeenCalledTimes(1)

    // ponytail: backdrop is the dialog's parent, not necessarily body's first
    // child (the test's own render container is appended to body too).
    const backdrop = document.body.querySelector('[role="dialog"]')!.parentElement as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('closes on Escape key', () => {
    useDelegationMessagesMock.mockReturnValue({ messages: [], isLoading: false, error: null })
    const onClose = vi.fn()
    renderInto(<DelegationDetailModal childSessionId="child-1" onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
