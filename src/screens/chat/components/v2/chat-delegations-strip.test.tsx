// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { fireEvent } from '@testing-library/dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ChatDelegations } from './chat-delegations-strip'
import type { ChatDelegationEntry } from '../../chat-delegations'

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function renderInto(ui: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  act(() => {
    createRoot(container).render(
      <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>,
    )
  })
  return container
}

function entry(overrides: Partial<ChatDelegationEntry>): ChatDelegationEntry {
  return {
    id: 'e1',
    childSessionKey: 'child-1',
    agentName: 'sub-agent',
    label: null,
    task: 'Do the thing',
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    elapsedMs: 0,
    tokenCount: 0,
    error: null,
    ...overrides,
  }
}

describe('ChatDelegations strip', () => {
  it('renders null when there is nothing visible (no layout shift)', () => {
    const container = renderInto(<ChatDelegations delegations={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders only running cards with agent, status, goal, model, tokens, and session', () => {
    const container = renderInto(
      <ChatDelegations
        delegations={[
          entry({ agentName: 'leaf', label: 'gpt-5.4', tokenCount: 3200 }),
          entry({ id: 'e2', task: 'Already done', status: 'completed', endedAt: Date.now() }),
        ]}
      />,
    )
    expect(container.textContent).toContain('Sub-agent delegations')
    expect(container.textContent).toContain('1 visible')
    expect(container.textContent).toContain('Do the thing')
    expect(container.textContent).toContain('leaf')
    expect(container.textContent).toContain('running')
    expect(container.textContent).toContain('gpt-5.4')
    expect(container.textContent).toContain('3,200 tokens')
    expect(container.textContent).toContain('session child-1')
    expect(container.textContent).not.toContain('Already done')
  })

  it('calls onOpenDelegation when a card with a child session key is clicked', () => {
    const onOpenDelegation = vi.fn()
    const container = renderInto(
      <ChatDelegations delegations={[entry({})]} onOpenDelegation={onOpenDelegation} />,
    )
    const card = container.querySelector('[role="button"]')!
    fireEvent.click(card)
    expect(onOpenDelegation).toHaveBeenCalledWith('child-1')
  })

  it('does not make a card clickable when there is no child session key yet', () => {
    const container = renderInto(
      <ChatDelegations
        delegations={[entry({ childSessionKey: '' })]}
        onOpenDelegation={vi.fn()}
      />,
    )
    expect(container.querySelector('[role="button"]')).toBeNull()
  })

  it('collapses the card list when the header is toggled', () => {
    const container = renderInto(<ChatDelegations delegations={[entry({})]} />)
    expect(container.textContent).toContain('Do the thing')
    act(() => {
      fireEvent.click(container.querySelector('button')!)
    })
    expect(container.textContent).not.toContain('Do the thing')
  })
})
