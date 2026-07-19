// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentMemoryTab } from './agent-memory-tab'
import { useMemoryAgentStore } from '@/stores/memory-screen-store'

vi.mock('./memory-detail-drawer', () => ({ MemoryDetailDrawer: () => null }))
vi.mock('@/screens/profiles/components/confirm-dialog', () => ({
  ConfirmDialog: () => null,
}))
vi.mock('@/components/ui/toast', () => ({ toast: vi.fn() }))

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AgentMemoryTab />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useMemoryAgentStore.setState({ selectedAgentId: 'hermes-switch' })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AgentMemoryTab', () => {
  it('shows the standard agent profile files as tabs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input)
        const filename = new URL(url, 'http://localhost').searchParams.get(
          'filename',
        )

        if (filename) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                agent: 'hermes-switch',
                filename,
                content: `# ${filename}`,
                sizeBytes: 10,
                modifiedAt: '2026-07-19T00:00:00.000Z',
              }),
          })
        }

        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              agent: 'hermes-switch',
              files: ['SOUL.md', 'USER.md', 'MEMORY.md'].map((name) => ({
                filename: name,
                sizeBytes: 10,
                modifiedAt: '2026-07-19T00:00:00.000Z',
              })),
            }),
        })
      }),
    )

    renderTab()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /SOUL\.md/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /USER\.md/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /MEMORY\.md/i })).toBeTruthy()
    })
  })
})
