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
