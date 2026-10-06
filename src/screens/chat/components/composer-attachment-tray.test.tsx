// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import {
  ComposerAttachmentTray,
  attachmentBadge,
} from './composer-attachment-tray'
import type { ChatComposerAttachment } from './chat-composer-types'

describe('attachmentBadge', () => {
  it('extracts uppercase extension from file name', () => {
    expect(attachmentBadge('document.pdf')).toBe('PDF')
    expect(attachmentBadge('analysis.md')).toBe('MD')
    expect(attachmentBadge('photo.png')).toBe('PNG')
    expect(attachmentBadge('script.tsx')).toBe('TSX')
  })

  it('falls back to contentType or FILE', () => {
    expect(attachmentBadge(undefined, 'image/jpeg')).toBe('JPG')
    expect(attachmentBadge('unknown')).toBe('FILE')
  })
})

describe('ComposerAttachmentTray', () => {
  afterEach(() => {
    cleanup()
  })

  const attachments: Array<ChatComposerAttachment> = [
    {
      id: 'att-1',
      name: 'notes.md',
      contentType: 'text/markdown',
      size: 14 * 1024,
    },
    {
      id: 'att-2',
      name: 'diagram.png',
      contentType: 'image/png',
      size: 1024 * 1024,
      previewUrl: 'data:image/png;base64,fake',
    },
  ]

  it('renders chips for each attachment with name, badge, and size', () => {
    const onRemove = vi.fn()
    render(
      <ComposerAttachmentTray
        attachments={attachments}
        onRemove={onRemove}
      />,
    )

    expect(screen.getByText('notes.md')).toBeDefined()
    expect(screen.getByText('diagram.png')).toBeDefined()
    expect(screen.getByText('14 KB')).toBeDefined()
    expect(screen.getByText('1 MB')).toBeDefined()
  })

  it('triggers onRemove with attachment id when remove button is clicked', () => {
    const onRemove = vi.fn()
    render(
      <ComposerAttachmentTray
        attachments={attachments}
        onRemove={onRemove}
      />,
    )

    const removeButtonNotes = screen.getByRole('button', { name: 'Remove notes.md' })
    const removeButtonDiagram = screen.getByRole('button', { name: 'Remove diagram.png' })
    expect(removeButtonNotes).toBeDefined()
    expect(removeButtonDiagram).toBeDefined()

    fireEvent.click(removeButtonNotes)
    expect(onRemove).toHaveBeenCalledWith('att-1')
  })

  it('renders nothing when attachments array is empty', () => {
    const { container } = render(
      <ComposerAttachmentTray attachments={[]} onRemove={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })
})
