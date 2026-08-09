// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfirmDialog } from './confirm-dialog'

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

function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    ;(document.activeElement ?? document).dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    )
  })
}

function dialog(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.pf-confirm')
  if (!el) throw new Error('dialog is not open')
  return el
}

function buttons(): Array<HTMLButtonElement> {
  return Array.from(dialog().querySelectorAll('button'))
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const base = {
  title: 'Delete agent?',
  message: 'This moves it to Recently Deleted.',
}

/** A trigger + the dialog, so focus restore has somewhere real to return to. */
function Harness({
  onCancel,
  onConfirm = () => {},
}: {
  onCancel?: () => void
  onConfirm?: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" id="trigger" onClick={() => setOpen(true)}>
        Delete
      </button>
      <ConfirmDialog
        {...base}
        open={open}
        onConfirm={onConfirm}
        onCancel={() => {
          setOpen(false)
          onCancel?.()
        }}
      />
    </>
  )
}

describe('ConfirmDialog — focus management (P-16)', () => {
  it('moves focus into the dialog when it opens', () => {
    render(<ConfirmDialog {...base} open onConfirm={() => {}} onCancel={() => {}} />)
    expect(dialog().contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(buttons()[0])
  })

  it('leaves focus alone while it is closed', () => {
    render(
      <ConfirmDialog {...base} open={false} onConfirm={() => {}} onCancel={() => {}} />,
    )
    expect(document.querySelector('.pf-confirm')).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('returns focus to the trigger when it closes', () => {
    const container = render(<Harness />)
    const trigger = container.querySelector<HTMLButtonElement>('#trigger')!
    trigger.focus()
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(dialog().contains(document.activeElement)).toBe(true)

    press('Escape')
    expect(document.querySelector('.pf-confirm')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('cycles Tab inside the dialog instead of walking out of it', () => {
    render(<ConfirmDialog {...base} open onConfirm={() => {}} onCancel={() => {}} />)
    const [cancel, confirm] = buttons()

    expect(document.activeElement).toBe(cancel)
    confirm.focus()
    press('Tab')
    expect(document.activeElement).toBe(cancel)

    press('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(confirm)
  })

  it('pulls focus back in if it somehow escaped', () => {
    const container = render(
      <>
        <button type="button" id="outside">
          outside
        </button>
        <ConfirmDialog {...base} open onConfirm={() => {}} onCancel={() => {}} />
      </>,
    )
    container.querySelector<HTMLButtonElement>('#outside')!.focus()
    press('Tab')
    expect(document.activeElement).toBe(buttons()[0])
  })
})

describe('ConfirmDialog — Escape', () => {
  it('cancels on Escape', () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog {...base} open onConfirm={() => {}} onCancel={onCancel} />)
    press('Escape')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('never confirms on Escape', () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog {...base} open onConfirm={onConfirm} onCancel={() => {}} />)
    press('Escape')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('ignores Escape when it is closed', () => {
    const onCancel = vi.fn()
    render(
      <ConfirmDialog {...base} open={false} onConfirm={() => {}} onCancel={onCancel} />,
    )
    press('Escape')
    expect(onCancel).not.toHaveBeenCalled()
  })
})

describe('ConfirmDialog — stacking', () => {
  it('only the innermost dialog answers Escape', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    render(
      <>
        <ConfirmDialog
          title="Outer"
          message="outer"
          open
          onConfirm={() => {}}
          onCancel={outer}
        />
        <ConfirmDialog
          title="Inner"
          message="inner"
          open
          onConfirm={() => {}}
          onCancel={inner}
        />
      </>,
    )
    press('Escape')
    // One Escape must not cancel a confirmation *and* whatever raised it.
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })
})

describe('ConfirmDialog — labelling', () => {
  it('names itself from its own title and message', () => {
    render(<ConfirmDialog {...base} open onConfirm={() => {}} onCancel={() => {}} />)
    const el = dialog()
    expect(el.getAttribute('role')).toBe('dialog')
    expect(el.getAttribute('aria-modal')).toBe('true')
    expect(
      document.getElementById(el.getAttribute('aria-labelledby')!)?.textContent,
    ).toBe(base.title)
    expect(
      document.getElementById(el.getAttribute('aria-describedby')!)?.textContent,
    ).toBe(base.message)
  })
})
