// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { fireEvent } from '@testing-library/dom'
import { DelegationTabView } from './delegation-tab-view'

const useDelegationsMock = vi.fn()
const useDelegationMessagesMock = vi.fn()

vi.mock('../../hooks/use-delegations', () => ({
  useDelegations: (...args: Array<unknown>) => useDelegationsMock(...args),
  useDelegationMessages: (...args: Array<unknown>) => useDelegationMessagesMock(...args),
}))

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

beforeEach(() => {
  useDelegationMessagesMock.mockReturnValue({ messages: [], isLoading: false, error: null })
})

function renderInto(ui: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  return container
}

describe('DelegationTabView', () => {
  it('shows the empty state when there are no delegations', () => {
    useDelegationsMock.mockReturnValue({ delegations: [], isLoading: false, error: null })
    const container = renderInto(<DelegationTabView sessionKey="s1" />)
    expect(container.textContent).toMatch(/No delegations in this session/)
  })

  it('shows an error state', () => {
    useDelegationsMock.mockReturnValue({
      delegations: [],
      isLoading: false,
      error: 'boom',
    })
    const container = renderInto(<DelegationTabView sessionKey="s1" />)
    expect(container.textContent).toMatch(/boom/)
  })

  it('renders a card per delegation with fallbacks for sparse data', () => {
    useDelegationsMock.mockReturnValue({
      delegations: [
        {
          childSessionId: 'child-1',
          goal: '',
          model: '',
          status: 'running',
          inputTokens: 0,
          outputTokens: 0,
          startedAt: null,
          endedAt: null,
        },
      ],
      isLoading: false,
      error: null,
    })
    useDelegationMessagesMock.mockReturnValue({ messages: [], isLoading: false, error: null })

    const container = renderInto(<DelegationTabView sessionKey="s1" />)
    expect(container.textContent).toMatch(/Untitled delegation/)
    expect(container.textContent).toMatch(/unknown/)
    expect(container.textContent).toMatch(/running/)
  })

  it('expands delegation activity inline when a card is clicked', () => {
    useDelegationsMock.mockReturnValue({
      delegations: [
        {
          childSessionId: 'child-1',
          goal: 'Do the thing',
          model: 'gpt-4',
          status: 'running',
          inputTokens: 1,
          outputTokens: 2,
          startedAt: 1_000,
          endedAt: null,
        },
      ],
      isLoading: false,
      error: null,
    })
    useDelegationMessagesMock.mockReturnValue({ messages: [], isLoading: false, error: null })

    const container = renderInto(<DelegationTabView sessionKey="s1" />)
    expect(container.textContent).not.toContain('No activity recorded.')

    act(() => {
      fireEvent.click(container.querySelector('button')!)
    })

    expect(container.textContent).toContain('No activity recorded.')
    expect(useDelegationMessagesMock).toHaveBeenLastCalledWith('child-1')
  })
})
