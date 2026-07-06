// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatMetaBarV2 } from './chat-meta-bar-v2'

type MockQueryResult = {
  data?: unknown
  isLoading?: boolean
  isError?: boolean
}

const { mockQueries, mockStatus, baseStatus } = vi.hoisted(() => {
  const initialStatus = {
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
  return {
    baseStatus: initialStatus,
    mockStatus: { ...initialStatus },
    mockQueries: {
      'claude|models': { data: undefined, isLoading: false, isError: false },
      'profiles|composer': {
        data: undefined,
        isLoading: false,
        isError: false,
      },
      'workspace|composer-context': {
        data: undefined,
        isLoading: false,
        isError: false,
      },
      'gateway-status|mode': {
        data: undefined,
        isLoading: false,
        isError: false,
      },
      'dashboard|model-info': {
        data: undefined,
        isLoading: false,
        isError: false,
      },
    },
  }
})

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: Array<string> }) =>
    mockQueries[queryKey.join('|')] ?? {
      data: undefined,
      isLoading: false,
      isError: false,
    },
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

vi.mock('@/hooks/use-session-status', () => ({
  useSessionStatus: () => mockStatus,
}))

beforeEach(() => {
  Object.assign(mockStatus, baseStatus)
  mockQueries['claude|models'] = {
    data: undefined,
    isLoading: false,
    isError: false,
  }
  mockQueries['profiles|composer'] = {
    data: undefined,
    isLoading: false,
    isError: false,
  }
  mockQueries['workspace|composer-context'] = {
    data: undefined,
    isLoading: false,
    isError: false,
  }
  mockQueries['gateway-status|mode'] = {
    data: undefined,
    isLoading: false,
    isError: false,
  }
  mockQueries['dashboard|model-info'] = {
    data: undefined,
    isLoading: false,
    isError: false,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: false })),
  )
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
      <ChatMetaBarV2
        sessionKey="t_49b85d13"
        isStreaming={false}
        toolCount={14}
        profile="default"
      />,
    )
    expect(container.querySelector('[data-testid="meta-tools"]')).toBeNull()
  })

  it('does not render the removed profile field', () => {
    const container = renderInto(
      <ChatMetaBarV2
        sessionKey="abc"
        isStreaming={false}
        toolCount={0}
        profile="default"
      />,
    )
    expect(container.querySelector('[data-testid="meta-profile"]')).toBeNull()
  })

  it('renders session id field', () => {
    const container = renderInto(<ChatMetaBarV2 sessionKey="t_49b85d13" />)
    const sid = container.querySelector('[data-testid="meta-session-id"]')
    expect(sid?.textContent).toContain('session')
  })

  it('shows tok/s when streaming and tokPerSec provided', () => {
    const container = renderInto(
      <ChatMetaBarV2
        sessionKey="abc"
        isStreaming={true}
        tokPerSec={37}
        toolCount={0}
      />,
    )
    const tps = container.querySelector('[data-testid="tok-per-sec"]')
    expect(tps?.textContent).toContain('37')
  })

  it('hides tok/s when not streaming', () => {
    const container = renderInto(
      <ChatMetaBarV2
        sessionKey="abc"
        isStreaming={false}
        tokPerSec={37}
        toolCount={0}
      />,
    )
    const tps = container.querySelector('[data-testid="tok-per-sec"]')
    expect(tps).toBeNull()
  })

  it('renders selectors slot (model/provider live here, not a standalone field)', () => {
    const container = renderInto(<ChatMetaBarV2 sessionKey="t_49b85d13" />)
    const selectors = container.querySelector('[data-testid="meta-selectors"]')
    expect(selectors).not.toBeNull()
  })

  it('tolerates null profile and workspace rows from query payloads', () => {
    mockQueries['profiles|composer'] = {
      data: {
        activeProfile: null,
        profiles: [null, { name: 'default', active: true }, { name: '' }],
      },
      isLoading: false,
      isError: false,
    }
    mockQueries['workspace|composer-context'] = {
      data: {
        path: '/repo',
        folderName: 'repo',
        workspaces: [null, { path: '/repo', name: null }, { path: '' }],
      },
      isLoading: false,
      isError: false,
    }

    expect(() => renderInto(<ChatMetaBarV2 sessionKey="abc" />)).not.toThrow()
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

  it('never renders an api-call count field', () => {
    mockStatus.apiCallCount = 42
    const container = renderInto(<ChatMetaBarV2 sessionKey="abc" />)
    expect(container.querySelector('[data-testid="meta-apicalls"]')).toBeNull()
  })
})
