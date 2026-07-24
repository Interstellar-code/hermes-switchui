// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
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
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
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
  {
    name: 'catalog.sqlite3',
    path: 'catalog.sqlite3',
    type: 'file' as const,
    size: 4096,
    modifiedAt: '2026-07-24T10:00:00.000Z',
  },
]

function filesResponse() {
  return new Response(
    JSON.stringify({ root: '', base: '/workspace', entries }),
    {
      status: 200,
    },
  )
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
      if (url === '/api/files?action=list')
        return Promise.resolve(filesResponse())
      if (url.startsWith('/api/files?action=read')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              type: 'text',
              path: 'src/app.ts',
              content: 'export {}',
            }),
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

    await waitFor(() =>
      expect(screen.getByLabelText('File preview')).toBeTruthy(),
    )
    expect(screen.getAllByText('app.ts')).not.toHaveLength(0)
  })

  it('does not decode SQLite databases as text', async () => {
    useSearch.mockReturnValue({ open: 'catalog.sqlite3' })
    render(<FilesScreen />)

    await screen.findByLabelText('File preview')
    expect(screen.getByText('No preview for this file type')).toBeTruthy()
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('action=read&path=catalog.sqlite3'),
    )
  })

  it('navigates to a parent folder from the preview breadcrumb', async () => {
    render(<FilesScreen />)

    const preview = await screen.findByLabelText('File preview')
    fireEvent.click(within(preview).getByRole('button', { name: 'src' }))

    expect(await screen.findByLabelText('Folder listing')).toBeTruthy()
  })

  it('shows row numbers and folder item counts beside folder names', async () => {
    useSearch.mockReturnValue({})
    render(<FilesScreen />)

    const listing = await screen.findByLabelText('Folder listing')
    expect(
      within(listing).getByRole('columnheader', { name: 'Sl. No.' }),
    ).toBeTruthy()
    expect(
      within(listing).queryByRole('columnheader', { name: 'Items' }),
    ).toBeNull()
    const sourceRow = within(listing).getByText('src').closest('tr')
    expect(sourceRow?.querySelector('.col-serial')?.textContent).toBe('1')
    expect(sourceRow?.querySelector('.files-folder-count')?.textContent).toBe(
      '1',
    )
  })

  it('shows a context menu for a folder-listing row and copies its path', async () => {
    useSearch.mockReturnValue({})
    render(<FilesScreen />)

    const sourceRows = await screen.findAllByText('src')
    const listingRow = sourceRows.find((node) => node.closest('tr'))
    expect(listingRow).toBeTruthy()
    fireEvent.contextMenu(listingRow!, { clientX: 120, clientY: 90 })

    expect(
      await screen.findByRole('menu', { name: 'File actions' }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /copy path/i }))

    await waitFor(() =>
      expect(writeTextToClipboard).toHaveBeenCalledWith('workspace/src'),
    )
  })
})
