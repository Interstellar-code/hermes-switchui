// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { fireEvent } from '@testing-library/dom'
import { DelegationSidebarOverlay } from './delegation-tab-view'

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

describe('DelegationSidebarOverlay', () => {
  it('shows the empty state when there are no agents', () => {
    useDelegationsMock.mockReturnValue({ delegations: [], isLoading: false, error: null })
    const container = renderInto(<DelegationSidebarOverlay sessionKey="s1" onClose={() => {}} />)
    expect(container.textContent).toMatch(/No agents in this session/)
  })

  it('shows an error state', () => {
    useDelegationsMock.mockReturnValue({
      delegations: [],
      isLoading: false,
      error: 'boom',
    })
    const container = renderInto(<DelegationSidebarOverlay sessionKey="s1" onClose={() => {}} />)
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

    const container = renderInto(<DelegationSidebarOverlay sessionKey="s1" onClose={() => {}} />)
    expect(container.textContent).toMatch(/Untitled agent task/)
    expect(container.textContent).toMatch(/unknown/)
    expect(container.textContent).toMatch(/Working/)
    expect(container.textContent).toMatch(/1 live/)
    expect(container.querySelector('[aria-label="Delegated subagent"]')?.textContent).toBe('SUB')
  })

  it('renders the assigned profile glyph when the delegation identifies its agent', () => {
    useDelegationsMock.mockReturnValue({
      delegations: [{
        childSessionId: 'child-neo', agentId: 'neo', goal: 'Implement it', model: 'auto',
        status: 'running', inputTokens: 0, outputTokens: 0, startedAt: null, endedAt: null,
      }],
      isLoading: false,
      error: null,
    })

    const container = renderInto(<DelegationSidebarOverlay sessionKey="s1" onClose={() => {}} />)
    expect(container.querySelector('[aria-label="Assigned agent: Neo"]')?.textContent).toBe('NE')
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

    const container = renderInto(<DelegationSidebarOverlay sessionKey="s1" onClose={() => {}} />)
    expect(container.textContent).not.toContain('No activity recorded.')

    const delegationButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent.includes('Do the thing'),
    )
    act(() => { delegationButton?.click() })

    expect(container.textContent).toContain('No activity recorded.')
    expect(useDelegationMessagesMock).toHaveBeenLastCalledWith('child-1')
    expect(delegationButton?.getAttribute('aria-expanded')).toBe('true')
  })

  it('uses a distinct settled status rather than a live indicator', () => {
    useDelegationsMock.mockReturnValue({
      delegations: [
        {
          childSessionId: 'child-1',
          goal: 'Finished task',
          model: 'gpt-4',
          status: 'completed',
          inputTokens: 1_000,
          outputTokens: 2_500,
          startedAt: 1_000,
          endedAt: 2_000,
        },
      ],
      isLoading: false,
      error: null,
    })

    const container = renderInto(<DelegationSidebarOverlay sessionKey="s1" onClose={() => {}} />)
    expect(container.textContent).toContain('Completed')
    expect(container.textContent).not.toContain('live')
    expect(container.textContent).toContain('3.5k tok')
  })

  it('shows a completed agent response when its transcript has no tool calls', () => {
    useDelegationsMock.mockReturnValue({
      delegations: [{
        childSessionId: 'child-1', goal: 'Assess it', model: 'auto', status: 'completed',
        inputTokens: 0, outputTokens: 0, startedAt: 1_000, endedAt: 2_000,
      }],
      isLoading: false,
      error: null,
    })
    useDelegationMessagesMock.mockReturnValue({
      messages: [{
        role: 'assistant',
        content: [{ type: 'text', text: 'This task needs no tool calls.' }],
      }],
      isLoading: false,
      error: null,
    })

    const container = renderInto(<DelegationSidebarOverlay sessionKey="s1" onClose={() => {}} />)
    const delegationButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent.includes('Assess it'),
    )
    act(() => { delegationButton?.click() })

    expect(container.textContent).toContain('No tool activity recorded.')
    expect(container.textContent).toContain('Agent response')
    expect(container.textContent).toContain('This task needs no tool calls.')
  })

  it('closes from the backdrop or Escape key', () => {
    useDelegationsMock.mockReturnValue({ delegations: [], isLoading: false, error: null })
    const onClose = vi.fn()
    const container = renderInto(<DelegationSidebarOverlay sessionKey="s1" onClose={onClose} />)

    act(() => { fireEvent.keyDown(window, { key: 'Escape' }) })
    expect(onClose).toHaveBeenCalledTimes(1)

    const backdrop = container.querySelector<HTMLButtonElement>('button[aria-label="Close agents"]')
    act(() => { backdrop?.click() })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
