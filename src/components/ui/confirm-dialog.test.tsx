// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfirmDialog, useConfirm } from './confirm-dialog'

const roots: Array<ReturnType<typeof createRoot>> = []

function render(ui: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(ui)
  })
  return container
}

function dialog(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[role="dialog"]')
  if (!el) throw new Error('dialog is not open')
  return el
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(dialog().querySelectorAll('button')).find(
    (el) => el.textContent.trim() === label,
  )
  if (!match) throw new Error(`no "${label}" button`)
  return match
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const base = { title: 'Update Hermes Switch UI?', message: '8ade871 → f43cec1.' }

describe('ConfirmDialog', () => {
  it('renders nothing while closed', () => {
    render(
      <ConfirmDialog
        {...base}
        open={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('labels itself from its own title and message', () => {
    render(
      <ConfirmDialog {...base} open onConfirm={() => {}} onCancel={() => {}} />,
    )
    const el = dialog()
    expect(el.getAttribute('aria-modal')).toBe('true')
    expect(
      document.getElementById(el.getAttribute('aria-labelledby')!)?.textContent,
    ).toBe(base.title)
    expect(
      document.getElementById(el.getAttribute('aria-describedby')!)?.textContent,
    ).toBe(base.message)
  })

  it('starts focus on Cancel so a stray Enter does not run the action', () => {
    render(
      <ConfirmDialog {...base} open onConfirm={() => {}} onCancel={() => {}} />,
    )
    expect(document.activeElement).toBe(button('Cancel'))
  })

  it('cancels on Escape and never confirms', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog {...base} open onConfirm={onConfirm} onCancel={onCancel} />,
    )
    act(() => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

/** Mirrors how the Update Center calls it: await, then act on the answer. */
function Harness({ onAnswer }: { onAnswer: (answer: boolean) => void }) {
  const { confirm, confirmDialog } = useConfirm()
  return (
    <>
      <button
        type="button"
        id="trigger"
        onClick={() => {
          void confirm({ ...base, confirmLabel: 'Update' }).then(onAnswer)
        }}
      >
        Update
      </button>
      {confirmDialog}
    </>
  )
}

describe('useConfirm', () => {
  it('resolves true only when the confirm button is pressed', async () => {
    const onAnswer = vi.fn()
    const container = render(<Harness onAnswer={onAnswer} />)
    click(container.querySelector<HTMLButtonElement>('#trigger')!)

    click(button('Update'))
    await act(async () => {})

    expect(onAnswer).toHaveBeenCalledWith(true)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('resolves false on cancel', async () => {
    const onAnswer = vi.fn()
    const container = render(<Harness onAnswer={onAnswer} />)
    click(container.querySelector<HTMLButtonElement>('#trigger')!)

    click(button('Cancel'))
    await act(async () => {})

    expect(onAnswer).toHaveBeenCalledWith(false)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('settles a pending promise when the owner unmounts', async () => {
    const onAnswer = vi.fn()
    const container = render(<Harness onAnswer={onAnswer} />)
    click(container.querySelector<HTMLButtonElement>('#trigger')!)
    expect(onAnswer).not.toHaveBeenCalled()

    for (const root of roots.splice(0)) act(() => root.unmount())
    await act(async () => {})

    // An awaited caller must never be left parked forever.
    expect(onAnswer).toHaveBeenCalledWith(false)
  })
})
