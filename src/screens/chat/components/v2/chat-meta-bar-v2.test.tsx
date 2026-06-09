// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatMetaBarV2 } from './chat-meta-bar-v2'

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined }),
  useMutation: () => ({
    mutate: () => undefined,
    mutateAsync: () => Promise.resolve(),
    isPending: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: () => Promise.resolve(),
    setQueryData: () => undefined,
    getQueryData: () => undefined,
  }),
}))

const { mockStatus, baseStatus } = vi.hoisted(() => {
  const baseStatus = {
    contextPercent: 0,
    maxTokens: 0,
    model: '',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    usedTokens: 0,
    cost: 0,
    estimatedCost: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    apiCallCount: 0,
    source: '',
    endReason: '',
  }
  return { baseStatus, mockStatus: { ...baseStatus } }
})

vi.mock('@/hooks/use-session-status', () => ({
  useSessionStatus: () => mockStatus,
}))

beforeEach(() => {
  Object.assign(mockStatus, baseStatus)
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })))
})

afterEach(() => {
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

describe('ChatMetaBarV2', () => {
  it('does not render the removed tools field', () => {
    const container = renderInto(
      <ChatMetaBarV2 sessionKey="t_49b85d13" isStreaming={false} toolCount={14} profile="default" />,
    )
    expect(container.querySelector('[data-testid="meta-tools"]')).toBeNull()
  })

  it('does not render the removed profile field', () => {
    const container = renderInto(
      <ChatMetaBarV2 sessionKey="abc" isStreaming={false} toolCount={0} profile="default" />,
    )
    expect(container.querySelector('[data-testid="meta-profile"]')).toBeNull()
  })

  it('renders session id field', () => {
    const container = renderInto(
      <ChatMetaBarV2 sessionKey="t_49b85d13" />,
    )
    const sid = container.querySelector('[data-testid="meta-session-id"]')
    expect(sid?.textContent).toContain('session')
  })

  it('shows tok/s when streaming and tokPerSec provided', () => {
    const container = renderInto(
      <ChatMetaBarV2 sessionKey="abc" isStreaming={true} tokPerSec={37} toolCount={0} />,
    )
    const tps = container.querySelector('[data-testid="tok-per-sec"]')
    expect(tps?.textContent).toContain('37')
  })

  it('hides tok/s when not streaming', () => {
    const container = renderInto(
      <ChatMetaBarV2 sessionKey="abc" isStreaming={false} tokPerSec={37} toolCount={0} />,
    )
    const tps = container.querySelector('[data-testid="tok-per-sec"]')
    expect(tps).toBeNull()
  })

  it('renders selectors slot (model/provider live here, not a standalone field)', () => {
    const container = renderInto(<ChatMetaBarV2 sessionKey="t_49b85d13" />)
    const selectors = container.querySelector('[data-testid="meta-selectors"]')
    expect(selectors).not.toBeNull()
  })

  it('shows cost field when session has spend', () => {
    mockStatus.cost = 0.0123
    const container = renderInto(<ChatMetaBarV2 sessionKey="abc" />)
    const cost = container.querySelector('[data-testid="meta-cost"]')
    expect(cost?.textContent).toContain('$0.012')
  })

  it('hides cost field when cost is zero', () => {
    mockStatus.cost = 0
    const container = renderInto(<ChatMetaBarV2 sessionKey="abc" />)
    expect(container.querySelector('[data-testid="meta-cost"]')).toBeNull()
  })

  it('shows tokens field when session has token usage', () => {
    mockStatus.totalTokens = 2_037_419
    const container = renderInto(<ChatMetaBarV2 sessionKey="abc" />)
    const tok = container.querySelector('[data-testid="meta-tokens"]')
    expect(tok?.textContent).toContain('2.0M')
  })

  it('hides tokens field when no usage', () => {
    const container = renderInto(<ChatMetaBarV2 sessionKey="abc" />)
    expect(container.querySelector('[data-testid="meta-tokens"]')).toBeNull()
  })

  it('shows api-call count when greater than zero', () => {
    mockStatus.apiCallCount = 42
    const container = renderInto(<ChatMetaBarV2 sessionKey="abc" />)
    const api = container.querySelector('[data-testid="meta-apicalls"]')
    expect(api?.textContent).toContain('42')
  })
})
