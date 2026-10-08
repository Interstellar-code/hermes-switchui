// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { ChatHeaderActionsV2 } from './chat-header-actions-v2'
import { useSessionsLocalStore } from '@/stores/sessions-local-store'

const patchBodies: Array<Record<string, unknown>> = []

function respond(input: unknown, init?: RequestInit): Response {
  const url = String(input)
  if (init?.method === 'PATCH') {
    patchBodies.push(JSON.parse(String(init.body)))
    return Response.json({ ok: true })
  }
  if (url.startsWith('/api/sessions?sessionKey=s1')) {
    return Response.json({
      sessions: [{ key: 's1', friendlyId: 's1', pinned: 1, archived: 1 }],
    })
  }
  return Response.json({})
}

beforeEach(() => {
  patchBodies.length = 0
  useSessionsLocalStore.setState({ archived: [], pinned: [], starred: [] })
  vi.stubGlobal('fetch', (input: unknown, init?: RequestInit) =>
    Promise.resolve(respond(input, init)),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderHeader() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatHeaderActionsV2 sessionId="chat:s1" sessionKey="s1" title="T" />
    </QueryClientProvider>,
  )
}

describe('ChatHeaderActionsV2 backend flags', () => {
  it('shows a backend pin as pressed and unpins on click', async () => {
    renderHeader()
    const pin = await screen.findByRole('button', { name: 'Unpin session' })
    expect(pin.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(pin)

    await waitFor(() => expect(patchBodies).toHaveLength(1))
    expect(patchBodies[0]).toMatchObject({ sessionKey: 's1', pinned: false })
  })

  it('shows a backend archive as pressed and unarchives on click', async () => {
    renderHeader()
    const archive = await screen.findByRole('button', {
      name: 'Unarchive session',
    })
    expect(archive.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(archive)

    await waitFor(() => expect(patchBodies).toHaveLength(1))
    expect(patchBodies[0]).toMatchObject({ sessionKey: 's1', archived: false })
  })
})
