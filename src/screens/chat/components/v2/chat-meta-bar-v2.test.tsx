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

type MockMutationOptions = {
  mutationFn?: (input: unknown) => Promise<unknown>
  onSuccess?: (data: unknown, input: unknown) => unknown
  onError?: (error: unknown, input: unknown) => unknown
}

type MockMutationHandlers = Pick<MockMutationOptions, 'onSuccess' | 'onError'>

const { mockNavigate, mockSearch } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockSearch: { profile: undefined as string | undefined },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => mockSearch,
}))

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
  const queries: Record<string, MockQueryResult> = {
    'claude|models': { data: undefined, isLoading: false, isError: false },
    'profiles|composer': { data: undefined, isLoading: false, isError: false },
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
    'profiles|scope-status': {
      data: undefined,
      isLoading: false,
      isError: false,
    },
  }
  return {
    baseStatus: initialStatus,
    mockStatus: { ...initialStatus },
    mockQueries: queries,
  }
})

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: Array<string> }) =>
    mockQueries[queryKey.join('|')] ?? {
      data: undefined,
      isLoading: false,
      isError: false,
    },
  useMutation: (options: MockMutationOptions = {}) => ({
    mutate: (input: unknown, handlers?: MockMutationHandlers) => {
      void options
        .mutationFn?.(input)
        .then((data) => {
          options.onSuccess?.(data, input)
          handlers?.onSuccess?.(data, input)
        })
        .catch((error: unknown) => {
          options.onError?.(error, input)
          handlers?.onError?.(error, input)
        })
    },
    mutateAsync: (input: unknown) => options.mutationFn?.(input),
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
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
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
  mockQueries['hermes-projects|list|[object Object]'] = {
    data: undefined,
    isLoading: false,
    isError: false,
  }
  mockQueries['hermes-projects|session|abc'] = {
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
  mockQueries['profiles|scope-status'] = {
    data: undefined,
    isLoading: false,
    isError: false,
  }
  mockNavigate.mockClear()
  mockSearch.profile = undefined
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
        toolCount={14}
        profile="default"
      />,
    )
    expect(container.querySelector('[data-testid="meta-tools"]')).toBeNull()
  })

  it('does not render the removed profile field', () => {
    const container = renderInto(
      <ChatMetaBarV2 sessionKey="abc" toolCount={0} profile="default" />,
    )
    expect(container.querySelector('[data-testid="meta-profile"]')).toBeNull()
  })

  it('renders session id field', () => {
    const container = renderInto(<ChatMetaBarV2 sessionKey="t_49b85d13" />)
    const sid = container.querySelector('[data-testid="meta-session-id"]')
    expect(sid?.textContent).toContain('session')
  })

  it('does not render the removed token-rate field', () => {
    const container = renderInto(<ChatMetaBarV2 sessionKey="abc" />)
    expect(container.querySelector('[data-testid="tok-per-sec"]')).toBeNull()
  })

  it('renders selectors slot (model/provider live here, not a standalone field)', () => {
    const container = renderInto(<ChatMetaBarV2 sessionKey="t_49b85d13" />)
    const selectors = container.querySelector('[data-testid="meta-selectors"]')
    expect(selectors).not.toBeNull()
  })

  it('shows each session binding and never changes the active project', async () => {
    mockQueries['hermes-projects|list|[object Object]'] = {
      data: {
        active_id: 'project-active',
        projects: [
          {
            id: 'project-active',
            slug: 'hermes-agent',
            name: 'Hermes Agent',
            icon: '⚡',
            color: '#00ff41',
            primary_path: '/Users/rohits/hermes-agent',
            board_slug: 'hermes-board',
            bound_board: { name: 'Hermes board' },
            is_active: true,
          },
          {
            id: 'project-other',
            slug: 'switchui',
            name: 'SwitchUI',
            icon: null,
            color: null,
            primary_path: '/Users/rohits/Development/hermes-switchui',
            board_slug: null,
            bound_board: null,
            is_active: false,
          },
        ],
      },
      isLoading: false,
      isError: false,
    }
    mockQueries['hermes-projects|session|chat-a'] = {
      data: {
        session_id: 'chat-a',
        project: {
          id: 'project-active',
          slug: 'hermes-agent',
          name: 'Hermes Agent',
        },
        source: 'binding',
      },
      isLoading: false,
      isError: false,
    }
    mockQueries['hermes-projects|session|chat-b'] = {
      data: {
        session_id: 'chat-b',
        project: { id: 'project-other', slug: 'switchui', name: 'SwitchUI' },
        source: 'binding',
      },
      isLoading: false,
      isError: false,
    }
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ projects: [], active_id: 'project-other' }),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const container = renderInto(<ChatMetaBarV2 sessionKey="chat-a" />)
    const selector = container.querySelector(
      '[data-testid="project-selector"]',
    ) as HTMLButtonElement
    expect(selector.textContent).toContain('Hermes Agent')

    const second = renderInto(<ChatMetaBarV2 sessionKey="chat-b" />)
    expect(
      second.querySelector('[data-testid="project-selector"]')?.textContent,
    ).toContain('SwitchUI')

    await act(() => {
      selector.click()
    })
    const option = document.querySelector(
      '[data-testid="project-option-project-other"]',
    ) as HTMLButtonElement
    expect(option.textContent).toContain('SwitchUI')
    expect(option.textContent).toContain(
      '/Users/rohits/Development/hermes-switchui',
    )

    await act(() => {
      option.click()
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/hermes-projects/session?sessionKey=chat-a',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/active'),
      expect.anything(),
    )
  })

  it('shows no project when a chat only inherits the profile default', () => {
    mockQueries['hermes-projects|list|[object Object]'] = {
      data: {
        active_id: 'project-active',
        projects: [
          {
            id: 'project-active',
            slug: 'india-grand-tour',
            name: 'India Grand Tour 2026',
            icon: null,
            color: null,
            is_active: true,
          },
        ],
      },
      isLoading: false,
      isError: false,
    }
    mockQueries['hermes-projects|session|new-chat'] = {
      data: {
        session_id: 'new-chat',
        project: {
          id: 'project-active',
          slug: 'india-grand-tour',
          name: 'India Grand Tour 2026',
        },
        source: 'active',
      },
      isLoading: false,
      isError: false,
    }

    const container = renderInto(<ChatMetaBarV2 sessionKey="new-chat" />)
    expect(
      container.querySelector('[data-testid="project-selector"]')?.textContent,
    ).toContain('No project')
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

  describe('profile scoping', () => {
    beforeEach(() => {
      mockQueries['profiles|composer'] = {
        data: {
          activeProfile: 'default',
          profiles: [{ name: 'default', active: true }, { name: 'other' }],
        },
        isLoading: false,
        isError: false,
      }
    })

    it('single mode: row click writes ?profile= via navigate and hides served badges', () => {
      mockQueries['profiles|scope-status'] = {
        data: { mode: 'single', servedProfiles: null, sessionCounts: {} },
        isLoading: false,
        isError: false,
      }

      const container = renderInto(
        <ChatMetaBarV2 sessionKey="abc" profileMutable />,
      )
      act(() => {
        container
          .querySelector<HTMLButtonElement>('[data-testid="profile-selector"]')
          ?.click()
      })
      const row = document.body.querySelector<HTMLButtonElement>(
        '[data-testid="profile-option-other"]',
      )
      expect(row?.textContent).not.toContain('Served')
      act(() => {
        row?.click()
      })

      expect(mockNavigate).toHaveBeenCalledTimes(1)
      const opts = mockNavigate.mock.calls[0][0] as {
        search: (prev: Record<string, unknown>) => Record<string, unknown>
      }
      expect(opts.search({})).toEqual({ profile: 'other' })
      // Scoping never calls the gateway-wide activate endpoint.
      expect(
        (fetch as ReturnType<typeof vi.fn>).mock.calls.some(
          (call: Array<unknown>) =>
            String(call[0]).includes('/api/profiles/activate'),
        ),
      ).toBe(false)
    })

    it('multiplex mode: shows per-row served/not-served badges', () => {
      mockQueries['profiles|scope-status'] = {
        data: {
          mode: 'multiplex',
          servedProfiles: ['default'],
          sessionCounts: { default: 3 },
        },
        isLoading: false,
        isError: false,
      }

      const container = renderInto(
        <ChatMetaBarV2 sessionKey="abc" profileMutable />,
      )
      act(() => {
        container
          .querySelector<HTMLButtonElement>('[data-testid="profile-selector"]')
          ?.click()
      })
      expect(
        document.body.querySelector('[data-testid="profile-option-default"]')
          ?.textContent,
      ).toContain('Served')
      expect(
        document.body.querySelector('[data-testid="profile-option-other"]')
          ?.textContent,
      ).toContain('Not served')

      const row = document.body.querySelector<HTMLButtonElement>(
        '[data-testid="profile-option-other"]',
      )
      act(() => {
        row?.click()
      })
      expect(mockNavigate).toHaveBeenCalledTimes(1)
    })

    it('multi-gateway topology: marks the unreachable profile at pick time, with the reason', () => {
      // One gateway per profile: `default` owns the port this workspace talks
      // to, `other` has a gateway process with no API server. Selecting
      // `other` can never send, so the picker says so here rather than letting
      // the send fail after the user has typed a message.
      mockQueries['profiles|scope-status'] = {
        data: {
          mode: 'single',
          servedProfiles: null,
          servingProfile: 'default',
          reason: null,
          profileGateways: [
            { profile: 'default', apiPort: 8642, matchesConfiguredApi: true },
            { profile: 'other', apiPort: null, matchesConfiguredApi: false },
          ],
          sessionCounts: {},
        },
        isLoading: false,
        isError: false,
      }

      const container = renderInto(
        <ChatMetaBarV2 sessionKey="abc" profileMutable />,
      )
      act(() => {
        container
          .querySelector<HTMLButtonElement>('[data-testid="profile-selector"]')
          ?.click()
      })

      const reachable = document.body.querySelector<HTMLButtonElement>(
        '[data-testid="profile-option-default"]',
      )
      expect(reachable?.dataset.reachability).toBe('served')
      // Quiet for the healthy row: no badge, no explanation.
      expect(reachable?.textContent).not.toContain('Not served')

      const unreachable = document.body.querySelector<HTMLButtonElement>(
        '[data-testid="profile-option-other"]',
      )
      expect(unreachable?.dataset.reachability).toBe('not-served')
      expect(unreachable?.textContent).toContain('Not served')
      expect(unreachable?.textContent).toMatch(/exposes no API server/i)
      expect(unreachable?.title).toMatch(/messages cannot be sent to it/i)

      // These tests share `document.body`; close the popover so its portal
      // content doesn't leak into the next one.
      act(() => {
        container
          .querySelector<HTMLButtonElement>('[data-testid="profile-selector"]')
          ?.click()
      })
    })

    it('keeps the selected profile when its row is clicked again', () => {
      mockSearch.profile = 'other'
      mockQueries['profiles|scope-status'] = {
        data: { mode: 'single', servedProfiles: null, sessionCounts: {} },
        isLoading: false,
        isError: false,
      }

      const container = renderInto(
        <ChatMetaBarV2 sessionKey="abc" profileMutable />,
      )
      act(() => {
        container
          .querySelector<HTMLButtonElement>('[data-testid="profile-selector"]')
          ?.click()
      })
      const row = document.body.querySelector<HTMLButtonElement>(
        '[data-testid="profile-option-other"]',
      )
      act(() => {
        row?.click()
      })

      const opts = mockNavigate.mock.calls[0][0] as {
        search: (prev: Record<string, unknown>) => Record<string, unknown>
      }
      expect(opts.search({ profile: 'other', foo: 'bar' })).toEqual({
        profile: 'other',
        foo: 'bar',
      })
    })

    it('locks the profile selector for an existing session', () => {
      mockSearch.profile = 'other'
      const container = renderInto(<ChatMetaBarV2 sessionKey="abc" />)
      const selector = container.querySelector<HTMLButtonElement>(
        '[data-testid="profile-selector"]',
      )

      expect(selector?.disabled).toBe(true)
      expect(selector?.title).toContain('Bound to other')
      act(() => selector?.click())
      expect(
        document.body.querySelector('[data-testid="profile-option-other"]'),
      ).toBeNull()
      expect(mockNavigate).not.toHaveBeenCalled()
    })
  })
})
