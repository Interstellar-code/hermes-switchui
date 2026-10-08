// @vitest-environment jsdom
/**
 * Bulk archive goes through the shared flag mutation. `fetch` is the stubbed
 * network edge; router and the projects/delete hooks (their own network
 * clients, unused by Archive) are stubbed so the bar renders.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { SidebarBulkActionsV2 } from './sidebar-bulk-actions-v2'
import type { SessionFeedItem } from '@/screens/chat/sessions-feed-types'
import { Toaster } from '@/components/ui/toast'
import { setSessionProfile } from '@/lib/session-scope'
import { useSessionsLocalStore } from '@/stores/sessions-local-store'
import { useSessionsSelectionStore } from '@/stores/sessions-selection-store'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouterState: () => '/',
}))
vi.mock('@/hooks/use-resolved-profile', () => ({
  useResolvedProfile: () => 'work',
}))
vi.mock('@/lib/projects-api', () => ({
  useSessionProjectMap: () => ({ data: undefined }),
  useBulkMoveSessions: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/screens/chat/hooks/use-delete-session', () => ({
  useBulkDeleteSessions: () => ({ deleteSessions: vi.fn(), progress: null }),
}))
vi.mock('./sidebar-folders-v2', () => ({
  FolderPickerList: () => null,
  useDismiss: () => {},
  useFolderFormStore: () => ({}),
}))

const patchBodies: Array<Record<string, unknown>> = []
let failKeys = new Set<string>()

const item = (key: string, serverSource = 'api'): SessionFeedItem =>
  ({
    id: `chat:${key}`,
    src: 'chat',
    title: key,
    sourceMeta: { key, friendlyId: key, serverSource },
  }) as unknown as SessionFeedItem

function respond(_input: unknown, init?: RequestInit): Response {
  if (init?.method === 'PATCH') {
    const body = JSON.parse(String(init.body))
    patchBodies.push(body)
    return failKeys.has(body.sessionKey)
      ? Response.json({ ok: false, error: 'boom' }, { status: 500 })
      : Response.json({ ok: true })
  }
  return Response.json({ sessions: [] })
}

beforeEach(() => {
  patchBodies.length = 0
  failKeys = new Set()
  setSessionProfile('work')
  useSessionsLocalStore.setState({ archived: [], pinned: [] })
  vi.stubGlobal('fetch', (_input: unknown, init?: RequestInit) =>
    Promise.resolve(respond(_input, init)),
  )
})

afterEach(() => {
  cleanup()
  setSessionProfile(null)
  useSessionsSelectionStore.getState().exit()
  vi.unstubAllGlobals()
})

function renderBar(items: Array<SessionFeedItem>) {
  useSessionsSelectionStore.setState({
    active: true,
    selected: Object.fromEntries(items.map((i) => [i.id, true])),
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <SidebarBulkActionsV2 items={items} />
    </QueryClientProvider>,
  )
}

describe('SidebarBulkActionsV2 archive', () => {
  it('reports failures with an error toast, keeps them selected, and sends the profile', async () => {
    failKeys = new Set(['b'])
    renderBar([item('a'), item('b')])

    fireEvent.click(screen.getByText('ARCHIVE'))

    await waitFor(() =>
      expect(document.body.textContent).toContain('Archived 1 of 2; 1 failed'),
    )
    expect(document.body.textContent).not.toContain('Archived 2 sessions')
    expect(patchBodies).toHaveLength(2)
    for (const body of patchBodies) {
      expect(body).toMatchObject({ archived: true, profile: 'work' })
    }
    expect(useSessionsSelectionStore.getState().selected).toEqual({
      'chat:b': true,
    })
  })

  it('keeps local portable sessions in the overlay without a PATCH', async () => {
    renderBar([item('loc-1', 'local')])

    fireEvent.click(screen.getByText('ARCHIVE'))

    await waitFor(() =>
      expect(useSessionsLocalStore.getState().archived).toEqual(['chat:loc-1']),
    )
    expect(patchBodies).toEqual([])
  })
})
