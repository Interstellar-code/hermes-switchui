// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApproveDialog, RejectDialog } from './approval-dialogs'
import type { ApprovalItem } from './approval-dialogs'

const item: ApprovalItem = {
  kind: 'approval',
  runId: 'run_8f2a',
  nodeRunId: 'node_8f2a_4',
  workflow: 'release-train',
  version: 'v3',
  pausedAt: '2026-10-09T08:40:00.000Z',
  progress: '4 of 6 steps',
  next: 'Publish GitHub release',
  agent: 'hermes-switch',
  at: '2026-10-09T08:40:00.000Z',
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ApproveDialog', () => {
  it('shows run details and the next step', () => {
    render(<ApproveDialog item={item} onClose={vi.fn()} onDone={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('dialog', { name: 'APPROVE RUN' })).toBeTruthy()
    expect(screen.getByText('release-train · v3')).toBeTruthy()
    expect(screen.getByText('run_8f2a')).toBeTruthy()
    expect(screen.getByText('Next: Publish GitHub release')).toBeTruthy()
  })

  it('posts the approval with the note', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}'))
    vi.stubGlobal('fetch', fetchMock)
    const onDone = vi.fn()
    render(<ApproveDialog item={item} onClose={vi.fn()} onDone={onDone} />)
    fireEvent.change(screen.getByLabelText('Note (optional)'), {
      target: { value: 'ship it' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM APPROVE' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('approved'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/workflow-runs/run_8f2a/approve')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      node_run_id: 'node_8f2a_4',
      decision: 'approved',
      response: 'ship it',
    })
  })

  it('shows the server error and stays open on a 400', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"error":"Invalid approval request"}', { status: 400 }),
        ),
    )
    const onDone = vi.fn()
    render(<ApproveDialog item={item} onClose={vi.fn()} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM APPROVE' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Invalid approval request',
    )
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('Escape closes and focus returns to the opener', () => {
    const onClose = vi.fn()
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { unmount } = render(
      <ApproveDialog item={item} onClose={onClose} onDone={vi.fn()} />,
    )
    expect(document.activeElement).not.toBe(opener)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('traps Tab inside the dialog', () => {
    render(<ApproveDialog item={item} onClose={vi.fn()} onDone={vi.fn()} />)
    const confirm = screen.getByRole('button', { name: 'CONFIRM APPROVE' })
    confirm.focus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' })
    expect(document.activeElement).toBe(
      screen.getByLabelText('Note (optional)'),
    )
  })
})

describe('RejectDialog', () => {
  it('disables confirm until a reason is given, then posts rejected', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}'))
    vi.stubGlobal('fetch', fetchMock)
    const onDone = vi.fn()
    render(<RejectDialog item={item} onClose={vi.fn()} onDone={onDone} />)
    const confirm = screen.getByRole('button', {
      name: 'CONFIRM REJECT',
    })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Reason (required)'), {
      target: { value: '   ' },
    })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Reason (required)'), {
      target: { value: 'wrong target' },
    })
    expect(confirm.hasAttribute('disabled')).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('rejected'))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/workflow-runs/run_8f2a/approve')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      node_run_id: 'node_8f2a_4',
      decision: 'rejected',
      response: 'wrong target',
    })
  })
})

describe('dialog review fixes', () => {
  it('Escape closes even when focus is on document.body', () => {
    const onClose = vi.fn()
    render(<ApproveDialog item={item} onClose={onClose} onDone={vi.fn()} />)
    ;(document.activeElement as HTMLElement).blur()
    expect(document.activeElement).toBe(document.body)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Tab from outside the dialog lands on its first control', () => {
    render(<ApproveDialog item={item} onClose={vi.fn()} onDone={vi.fn()} />)
    ;(document.activeElement as HTMLElement).blur()
    fireEvent.keyDown(document.body, { key: 'Tab' })
    expect(document.activeElement).toBe(
      screen.getByLabelText('Note (optional)'),
    )
  })

  it('pulls focus back when it moves outside', () => {
    const outside = document.createElement('button')
    document.body.append(outside)
    render(<ApproveDialog item={item} onClose={vi.fn()} onDone={vi.fn()} />)
    outside.focus()
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
    outside.remove()
  })

  it('while pending: CANCEL disabled, Escape ignored, one POST', async () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    const onClose = vi.fn()
    const onPending = vi.fn()
    render(
      <ApproveDialog
        item={item}
        onClose={onClose}
        onDone={vi.fn()}
        onPending={onPending}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM APPROVE' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'CANCEL' }).hasAttribute('disabled'),
      ).toBe(true),
    )
    expect(onPending).toHaveBeenCalledWith(true)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM APPROVE' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reject 400 shows the server error and stays open', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"error":"Run not found"}', { status: 400 }),
        ),
    )
    const onDone = vi.fn()
    render(<RejectDialog item={item} onClose={vi.fn()} onDone={onDone} />)
    fireEvent.change(screen.getByLabelText('Reason (required)'), {
      target: { value: 'nope' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM REJECT' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Run not found')
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('network failure shows an error and re-enables the form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    render(<ApproveDialog item={item} onClose={vi.fn()} onDone={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM APPROVE' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Network error. Try again.',
    )
    expect(
      screen.getByRole('button', { name: 'CANCEL' }).hasAttribute('disabled'),
    ).toBe(false)
  })
})
