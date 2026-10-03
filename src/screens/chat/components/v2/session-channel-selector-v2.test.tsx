// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { SessionChannelSelectorV2 } from './session-channel-selector-v2'
import type { Root } from 'react-dom/client'

const mocks = vi.hoisted(
  (): { data: unknown; toast: ReturnType<typeof vi.fn> } => ({
    data: undefined,
    toast: vi.fn(),
  }),
)

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mocks.data }),
  // Run the real mutationFn so the test sees the POST body.
  useMutation: (opts: {
    mutationFn: (v: unknown) => Promise<unknown>
    onSuccess?: (b: unknown, v: unknown) => void
  }) => ({
    mutate: (v: unknown) =>
      void opts.mutationFn(v).then((b) => opts.onSuccess?.(b, v)),
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
}))
vi.mock('@/components/ui/toast', () => ({ toast: mocks.toast }))
vi.mock('@/hooks/use-resolved-profile', () => ({
  useResolvedProfile: () => 'p1',
}))

const baseSession = {
  source: 'api_server',
  chat_id: null,
  thread_id: null,
  title: 'Chat',
  handoff_state: null,
  handoff_platform: null,
  handoff_error: null,
  handoff_requested_at: null,
}

const TELEGRAM = {
  id: 'telegram',
  name: 'Telegram',
  state: 'connected',
  homeChannel: { platform: 'telegram', chat_id: '42', name: 'Home' },
  unavailableReason: null,
}
const TARGET = {
  target: 'telegram:42:200',
  platform: 'telegram',
  chatId: '42',
  threadId: '200',
  label: 'Second topic',
  lastActive: Date.now() / 1000 - 7200,
}

let root: Root | null = null

function render(sessionKey: string | null = 's1') {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(<SessionChannelSelectorV2 sessionKey={sessionKey} />)
  })
  return container.querySelector<HTMLButtonElement>(
    '[data-testid="channel-selector"]',
  )
}

function rerender(data: unknown) {
  mocks.data = data
  act(() => {
    root!.render(<SessionChannelSelectorV2 sessionKey="s1" />)
  })
}

function byTestId(id: string) {
  return document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
}

describe('SessionChannelSelectorV2', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    mocks.toast.mockClear()
    mocks.data = { ok: true, session: baseSession, platforms: [] }
  })

  it('renders nothing for a new chat or a session with no row', () => {
    expect(render('new')).toBeNull()
    mocks.data = { ok: true, session: null, platforms: [] }
    expect(render()).toBeNull()
  })

  it('shows Web for an unconnected session', () => {
    expect(render()?.textContent).toContain('Web')
  })

  it('shows the Telegram topic once handed off', () => {
    mocks.data = {
      ok: true,
      session: {
        ...baseSession,
        source: 'telegram',
        thread_id: '77',
        title: null,
      },
      platforms: [],
    }
    expect(render()?.textContent).toContain('Telegram · topic 77')
  })

  it('prefers the session title once handed off', () => {
    mocks.data = {
      ok: true,
      session: { ...baseSession, source: 'telegram', thread_id: '77' },
      platforms: [],
    }
    expect(render()?.textContent).toContain('Telegram · Chat')
  })

  it('lists existing topics and posts the chosen target', async () => {
    mocks.data = {
      ok: true,
      session: baseSession,
      platforms: [TELEGRAM],
      targets: [TARGET],
    }
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true, session: baseSession }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const trigger = render()
    expect(trigger?.getAttribute('aria-haspopup')).toBe('dialog')
    act(() => trigger!.click())
    const option = byTestId('channel-target-telegram:42:200')
    expect(option?.textContent).toContain('Second topic')
    expect(option?.textContent).toContain('topic 200 · 2h ago')
    act(() => option!.click())
    expect(document.body.textContent).toContain(
      "Continue this session in 'Second topic'. Any session currently in that topic will be ended.",
    )
    expect(document.activeElement).toBe(byTestId('channel-confirm'))
    await act(async () => byTestId('channel-confirm')!.click())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/s1/channel?profile=p1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          platform: 'telegram',
          target: 'telegram:42:200',
        }),
      }),
    )
    vi.unstubAllGlobals()
  })

  it('toasts once when an in-flight handoff completes', () => {
    mocks.data = {
      ok: true,
      session: { ...baseSession, handoff_state: 'running' },
      platforms: [],
    }
    render()
    const done = {
      ok: true,
      session: { ...baseSession, handoff_state: 'completed' },
      platforms: [],
    }
    rerender(done)
    rerender({ ...done })
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith(
      'Session continued in a new topic',
      {
        type: 'success',
      },
    )
  })

  it('toasts the error when an in-flight handoff fails', () => {
    mocks.data = {
      ok: true,
      session: { ...baseSession, handoff_state: 'pending' },
      platforms: [],
    }
    render()
    rerender({
      ok: true,
      session: {
        ...baseSession,
        handoff_state: 'failed',
        handoff_error: 'chat not allowed',
      },
      platforms: [],
    })
    expect(mocks.toast).toHaveBeenCalledWith(
      'Handoff failed: chat not allowed',
      { type: 'error' },
    )
  })

  it('stops spinning and says so once a handoff is stale', () => {
    mocks.data = {
      ok: true,
      session: {
        ...baseSession,
        handoff_state: 'pending',
        handoff_requested_at: Date.now() / 1000 - 3600,
      },
      platforms: [],
    }
    const trigger = render()
    expect(trigger?.textContent).toContain('Waiting for gateway')
    expect(trigger?.querySelector('.animate-spin')).toBeNull()
  })

  it('shows a spinner while the handoff is in flight', () => {
    mocks.data = {
      ok: true,
      session: { ...baseSession, handoff_state: 'running' },
      platforms: [],
    }
    const trigger = render()
    expect(trigger?.textContent).toContain('Handing off')
    expect(trigger?.querySelector('.animate-spin')).not.toBeNull()
  })

  it('surfaces the failure reason in the tooltip', () => {
    mocks.data = {
      ok: true,
      session: {
        ...baseSession,
        handoff_state: 'failed',
        handoff_error: 'no topics',
      },
      platforms: [],
    }
    const trigger = render()
    expect(trigger?.textContent).toContain('Handoff failed')
    expect(trigger?.title).toBe('no topics')
  })
})
