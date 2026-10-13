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

function makeAssistantMessage(text: string): ChatMessage {
  return { role: 'assistant', id: 'msg-42', content: [{ type: 'text', text }] }
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
  return Array.from(queryDialog()?.querySelectorAll('button') ?? []).find(
    (b) => b.textContent === label,
  )
}

/**
 * getByLabelText-style lookup for the control a real `<label htmlFor>` points
 * at ("Context", "Prompt", "Title (optional)", "Model"). Returns null when the
 * labeled field is absent (e.g. Context/Prompt in full mode).
 */
function findField(
  labelText: string,
): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  const dialog = queryDialog()
  const label = Array.from(dialog?.querySelectorAll('label') ?? []).find(
    (l) => String(l.textContent).trim() === labelText,
  )
  const id = label?.getAttribute('for')
  return id ? dialog!.querySelector(`[id="${id}"]`) : null
}

/** Checkbox inputs are wrapped inside their label (no htmlFor). */
function findCheckbox(labelText: string): HTMLInputElement | null {
  const label = Array.from(queryDialog()?.querySelectorAll('label') ?? []).find(
    (l) => String(l.textContent).includes(labelText),
  )
  return label
    ? (label.querySelector('input[type="checkbox"]'))
    : null
}

/** Flip "Carry full thread history (fork)" to switch the dialog into full mode. */
function toggleCarryFull() {
  fireEvent.click(findCheckbox('Carry full thread history')!)
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('BranchMessageDialog', () => {
  describe('selection mode (default)', () => {
    it('prefills Context with the selected text when given', () => {
      renderDialog(
        <BranchMessageDialog
          message={makeMessage('whole message body')}
          messageCount={5}
          selectedText="hand-picked passage"
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      )

      const context = findField('Context') as HTMLTextAreaElement
      expect(context).not.toBeNull()
      expect(context.value).toBe('hand-picked passage')
    })

    it('prefills Context with the whole multi-line message text when no selection is given', () => {
      const text = '# Plan\n\nFirst paragraph.\n\n- item one\n- item two'
      renderDialog(
        <BranchMessageDialog
          message={makeAssistantMessage(text)}
          messageCount={5}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      )

      const context = findField('Context') as HTMLTextAreaElement
      expect(context).not.toBeNull()
      expect(context.value).toBe(text)
    })

    it('keeps Branch disabled until the prompt has non-whitespace text', () => {
      renderDialog(
        <BranchMessageDialog
          message={makeMessage('anchor text')}
          messageCount={4}
          selectedText="sel"
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      )

      const branch = findButton('Branch')!
      expect(branch.disabled).toBe(true)

      fireEvent.change(findField('Prompt')!, { target: { value: '   ' } })
      expect(branch.disabled).toBe(true)

      fireEvent.change(findField('Prompt')!, { target: { value: 'dig in' } })
      expect(branch.disabled).toBe(false)
    })

    it('Cmd+Enter in the Prompt textarea submits the selection payload', () => {
      const onConfirm = vi.fn()
      renderDialog(
        <BranchMessageDialog
          message={makeMessage('whole message body')}
          messageCount={5}
          selectedText="  picked passage  "
          onConfirm={onConfirm}
          onClose={vi.fn()}
        />,
      )

      fireEvent.change(findField('Prompt')!, {
        target: { value: '  go deep  ' },
      })
      fireEvent.keyDown(findField('Prompt')!, {
        key: 'Enter',
        metaKey: true,
      })

      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onConfirm).toHaveBeenCalledWith({
        mode: 'selection',
        quote: 'picked passage',
        prompt: 'go deep',
        endSource: false,
      })
    })

    it('confirm carries the edited Context text and the resolved model', () => {
      const onConfirm = vi.fn()
      renderDialog(
        <BranchMessageDialog
          message={makeMessage('original context')}
          messageCount={4}
          selectedText="original selection"
          defaultModel="source-model"
          modelOptions={['source-model', 'other-model']}
          onConfirm={onConfirm}
          onClose={vi.fn()}
        />,
      )

      // Selector defaults to the source session's model.
      expect((findField('Model') as HTMLSelectElement).value).toBe(
        'source-model',
      )

      // Context is editable — the confirm must carry the edited text.
      fireEvent.change(findField('Context')!, {
        target: { value: '  edited context  ' },
      })
      fireEvent.change(findField('Prompt')!, {
        target: { value: 'why does this branch' },
      })
      fireEvent.click(findButton('Branch')!)

      expect(onConfirm).toHaveBeenCalledWith({
        mode: 'selection',
        quote: 'edited context',
        prompt: 'why does this branch',
        model: 'source-model',
        endSource: false,
      })
    })
  })

  describe('full mode (fork)', () => {
    it('toggling carry-full hides Context/Prompt, shows close-original, and confirm emits the full payload', () => {
      const onConfirm = vi.fn()
      renderDialog(
        <BranchMessageDialog
          message={makeAssistantMessage('Some **markdown** reply')}
          messageCount={3}
          selectedText="sel"
          onConfirm={onConfirm}
          onClose={vi.fn()}
        />,
      )

      expect(findField('Context')).not.toBeNull()
      toggleCarryFull()

      expect(findField('Context')).toBeNull()
      expect(findField('Prompt')).toBeNull()
      expect(queryDialog()!.textContent).toContain(
        'Will copy 3 messages to a new session.',
      )
      expect(queryDialog()!.querySelector('p[title]')!.textContent).toContain(
        'Some markdown reply',
      )

      const closeOriginal = findCheckbox('Close original session')!
      expect(closeOriginal).not.toBeNull()
      fireEvent.click(closeOriginal)
      fireEvent.click(findButton('Branch')!)

      expect(onConfirm).toHaveBeenCalledWith({ mode: 'full', endSource: true })
    })

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

      toggleCarryFull()

      const dialog = queryDialog()
      expect(dialog).not.toBeNull()
      expect(dialog!.textContent).toContain('Will copy 7 messages')

      const preview = dialog!.querySelector('p[title]')!
      expect(preview.textContent).not.toContain('#')
      expect(preview.textContent).not.toContain('**')
      expect(preview.textContent.startsWith('“Heading Some bold text a link'))
      expect(preview.textContent.endsWith('…'))
      // 2 quote marks + ≤80-char slice + 1 ellipsis
      expect(preview.textContent.length).toBeLessThanOrEqual(2 + 80 + 1)
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

      toggleCarryFull()
      fireEvent.change(findField('Title (optional)')!, {
        target: { value: '  Branch plan  ' },
      })
      fireEvent.change(findField('Model')!, {
        target: { value: 'other-model' },
      })
      fireEvent.click(findCheckbox('Close original session')!)
      fireEvent.click(findButton('Branch')!)

      expect(onConfirm).toHaveBeenCalledWith({
        mode: 'full',
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
          messageCount={1}
          defaultModel="source-model"
          modelOptions={['source-model']}
          onConfirm={onConfirm}
          onClose={vi.fn()}
        />,
      )

      toggleCarryFull()
      expect(queryDialog()!.textContent).toContain(
        'Will copy 1 message to a new session.',
      )
      fireEvent.click(findButton('Branch')!)

      expect(onConfirm).toHaveBeenCalledWith({
        mode: 'full',
        endSource: false,
        model: 'source-model',
      })
    })

    it('Enter in the title input submits only while Branch is enabled, and Escape closes', () => {
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

      // Selection mode with a blank prompt: Branch is disabled, so Enter is a no-op.
      fireEvent.change(findField('Title (optional)')!, {
        target: { value: 'No prompt yet' },
      })
      fireEvent.keyDown(findField('Title (optional)')!, { key: 'Enter' })
      expect(onConfirm).not.toHaveBeenCalled()

      toggleCarryFull()
      // Mode switch remounts the form fields, so re-query the title input.
      const titleInput = findField('Title (optional)')!
      fireEvent.change(titleInput, { target: { value: 'Via enter' } })
      fireEvent.keyDown(titleInput, { key: 'Enter' })
      expect(onConfirm).toHaveBeenCalledWith({
        mode: 'full',
        title: 'Via enter',
        endSource: false,
      })

      fireEvent.keyDown(queryDialog()!, { key: 'Escape' })
      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('closing', () => {
    it('Escape and overlay clicks close without confirming', () => {
      const onConfirm = vi.fn()
      const onClose = vi.fn()
      renderDialog(
        <BranchMessageDialog
          message={makeMessage('anchor text')}
          messageCount={6}
          selectedText="sel"
          onConfirm={onConfirm}
          onClose={onClose}
        />,
      )

      fireEvent.keyDown(queryDialog()!, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)

      // The overlay is the parent of the dialog card.
      fireEvent.click(queryDialog()!.parentElement!)
      expect(onClose).toHaveBeenCalledTimes(2)

      expect(onConfirm).not.toHaveBeenCalled()
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
