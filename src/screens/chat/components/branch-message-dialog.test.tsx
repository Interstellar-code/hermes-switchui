// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { fireEvent } from '@testing-library/dom'
import { BranchMessageDialog } from './branch-message-dialog'
import type { ChatMessage } from '../types'

function makeMessage(text: string): ChatMessage {
  return { role: 'user', id: 'msg-42', content: [{ type: 'text', text }] }
}

function renderDialog(ui: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  return { root }
}

function queryDialog() {
  return document.body.querySelector('[role="dialog"]')
}

function findButton(label: string) {
  return Array.from(
    queryDialog()?.querySelectorAll('button') ?? [],
  ).find((b) => b.textContent === label)
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('BranchMessageDialog', () => {
  it('shows the copy count and a markdown-stripped, ellipsized preview', () => {
    renderDialog(
      <BranchMessageDialog
        message={makeMessage(
          `# Heading\n\nSome **bold** text and [a link](http://x)\n\n${'z'.repeat(100)}`,
        )}
        messageCount={7}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const dialog = queryDialog()
    expect(dialog).not.toBeNull()
    expect(dialog!.textContent).toContain('Will copy 7 messages')

    const preview = dialog!.querySelector('p[title]')!
    expect(preview.textContent).not.toContain('#')
    expect(preview.textContent).not.toContain('**')
    expect(preview.textContent!.startsWith('“Heading Some bold text a link'))
    expect(preview.textContent!.endsWith('…'))
    // 2 quote marks + ≤80-char slice + 1 ellipsis
    expect(preview.textContent!.length).toBeLessThanOrEqual(2 + 80 + 1)
  })

  it('confirm passes trimmed title, endSource, and the picked model', () => {
    const onConfirm = vi.fn()
    renderDialog(
      <BranchMessageDialog
        message={makeMessage('anchor text')}
        messageCount={3}
        defaultModel="source-model"
        modelOptions={['source-model', 'other-model']}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )

    const dialog = queryDialog()!
    fireEvent.change(dialog.querySelector('input[type="text"]')!, {
      target: { value: '  Branch plan  ' },
    })
    fireEvent.click(dialog.querySelector('input[type="checkbox"]')!)
    fireEvent.change(dialog.querySelector('select')!, {
      target: { value: 'other-model' },
    })
    fireEvent.click(findButton('Branch')!)

    expect(onConfirm).toHaveBeenCalledWith({
      title: 'Branch plan',
      endSource: true,
      model: 'other-model',
    })
  })

  it('confirm omits an empty title and defaults endSource off + model to defaultModel', () => {
    const onConfirm = vi.fn()
    renderDialog(
      <BranchMessageDialog
        message={makeMessage('anchor text')}
        messageCount={2}
        defaultModel="source-model"
        modelOptions={['source-model']}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(findButton('Branch')!)

    expect(onConfirm).toHaveBeenCalledWith({
      endSource: false,
      model: 'source-model',
    })
  })

  it('Enter in the title input submits and Escape closes', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    renderDialog(
      <BranchMessageDialog
        message={makeMessage('anchor text')}
        messageCount={1}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    const titleInput = queryDialog()!.querySelector('input[type="text"]')!
    fireEvent.change(titleInput, { target: { value: 'Via enter' } })
    fireEvent.keyDown(titleInput, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledWith({
      title: 'Via enter',
      endSource: false,
    })

    fireEvent.keyDown(queryDialog()!, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('cancel button closes without confirming', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    renderDialog(
      <BranchMessageDialog
        message={makeMessage('anchor text')}
        messageCount={4}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    fireEvent.click(findButton('Cancel')!)
    expect(onClose).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('hides the model selector when no options are given', () => {
    renderDialog(
      <BranchMessageDialog
        message={makeMessage('anchor text')}
        messageCount={4}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(queryDialog()!.querySelector('select')).toBeNull()
  })
})
