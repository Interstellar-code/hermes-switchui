// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FilesScreen } from './files-screen'

const { useSearch, writeTextToClipboard } = vi.hoisted(() => ({
  useSearch: vi.fn(),
  writeTextToClipboard: vi.fn(() => Promise.resolve()),
}))

vi.mock('@tanstack/react-router', () => ({ useSearch }))
vi.mock('@/hooks/use-page-title', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/lib/clipboard', () => ({ writeTextToClipboard }))
vi.mock('@/components/prompt-kit/markdown', () => ({
  Markdown: ({ children }: { children: string }) => <>{children}</>,
}))
vi.mock('@/components/shadcn/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const entries = [
  {
    name: 'src',
    path: 'src',
    type: 'folder' as const,
    children: [
      {
        name: 'app.ts',
        path: 'src/app.ts',
        type: 'file' as const,
        size: 42,
        modifiedAt: '2026-07-24T10:00:00.000Z',
      },
    ],
  },
]

function filesResponse() {
  return new Response(JSON.stringify({ root: '', base: '/workspace', entries }), {
    status: 200,
  })
}

beforeEach(() => {
  useSearch.mockReturnValue({ open: 'src/app.ts' })
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/workspace') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              path: '/workspace',
              folderName: 'workspace',
              source: 'config',
              isValid: true,
              workspaces: [],
              last: '/workspace',
            }),
            { status: 200 },
          ),
        )
      }
      if (url === '/api/files?action=list') return Promise.resolve(filesResponse())
      if (url.startsWith('/api/files?action=read')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ type: 'text', path: 'src/app.ts', content: 'export {}' }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response(null, { status: 200 }))
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('FilesScreen', () => {
  it('opens the file requested by the global-search open parameter', async () => {
    render(<FilesScreen />)

    await waitFor(() => expect(screen.getByLabelText('File preview')).toBeTruthy())
    expect(screen.getAllByText('app.ts')).not.toHaveLength(0)
  })

  it('shows a context menu for a folder-listing row and copies its path', async () => {
    useSearch.mockReturnValue({})
    render(<FilesScreen />)

    const sourceRows = await screen.findAllByText('src')
    const listingRow = sourceRows.find((node) => node.closest('tr'))
    expect(listingRow).toBeTruthy()
    fireEvent.contextMenu(listingRow!, { clientX: 120, clientY: 90 })

    expect(await screen.findByRole('menu', { name: 'File actions' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /copy path/i }))

    await waitFor(() =>
      expect(writeTextToClipboard).toHaveBeenCalledWith('workspace/src'),
    )
  })
})
