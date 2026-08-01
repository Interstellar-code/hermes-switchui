// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { FileExplorerSidebar } from './file-explorer-sidebar'

const { writeTextToClipboard } = vi.hoisted(() => ({
  writeTextToClipboard: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/clipboard', () => ({ writeTextToClipboard }))
vi.mock('./file-preview-dialog', () => ({ default: () => null }))

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            entries: [
              {
                name: 'image.png',
                path: 'assets/image.png',
                type: 'file',
              },
              {
                name: 'notes.md',
                path: 'docs/notes.md',
                type: 'file',
              },
              {
                name: 'script.ts',
                path: 'src/script.ts',
                type: 'file',
              },
            ],
            base: '/Users/rohits/workspace',
          }),
          { status: 200 },
        ),
      ),
    ),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function renderSidebar(
  overrides: {
    onAttachFile?: (path: string) => Promise<void>
  } = {},
) {
  return render(
    <FileExplorerSidebar
      collapsed={false}
      onToggle={vi.fn()}
      onInsertReference={vi.fn()}
      onAttachImage={vi.fn().mockResolvedValue(undefined)}
      onAttachFile={
        overrides.onAttachFile ?? vi.fn().mockResolvedValue(undefined)
      }
    />,
  )
}

describe('FileExplorerSidebar', () => {
  it('uses the Files v2 sidebar and quick-jump surfaces', async () => {
    const { container } = renderSidebar()

    await screen.findByText('image.png')
    expect(
      container.querySelector('[data-screen="files"] > aside.files-tree'),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Quick jump to any file' }),
    ).toBeTruthy()
  })

  it('offers chat and file actions for workspace images and copies real paths', async () => {
    renderSidebar()

    const entry = await screen.findByText('image.png')
    fireEvent.contextMenu(entry, { clientX: 120, clientY: 90 })

    expect(screen.getByRole('menuitem', { name: 'Open' })).toBeTruthy()
    expect(
      screen.getByRole('menuitem', { name: 'Add reference to chat' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('menuitem', { name: 'Attach image to chat' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('menuitem', { name: 'Attach to chat' }),
    ).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Download' })).toBeTruthy()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy path' }))
    await waitFor(() =>
      expect(writeTextToClipboard).toHaveBeenCalledWith(
        '/Users/rohits/workspace/assets/image.png',
      ),
    )
  })

  it('offers "Attach to chat" for attachable files and invokes the handler', async () => {
    const onAttachFile = vi.fn().mockResolvedValue(undefined)
    renderSidebar({ onAttachFile })

    const entry = await screen.findByText('notes.md')
    fireEvent.contextMenu(entry, { clientX: 120, clientY: 90 })

    const attachItem = screen.getByRole('menuitem', { name: 'Attach to chat' })
    expect(
      screen.queryByRole('menuitem', { name: 'Attach image to chat' }),
    ).toBeNull()

    fireEvent.click(attachItem)
    await waitFor(() =>
      expect(onAttachFile).toHaveBeenCalledWith('docs/notes.md'),
    )
  })

  it('hides "Attach to chat" for unsupported extensions', async () => {
    renderSidebar()

    const entry = await screen.findByText('script.ts')
    fireEvent.contextMenu(entry, { clientX: 120, clientY: 90 })

    expect(
      screen.getByRole('menuitem', { name: 'Add reference to chat' }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('menuitem', { name: 'Attach to chat' }),
    ).toBeNull()
  })
})
