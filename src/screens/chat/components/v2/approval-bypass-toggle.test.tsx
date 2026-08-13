// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The per-chat approval bypass switch.
 *
 * Everything asserted here is a safety property, not a styling preference:
 *
 *  - Turning the bypass ON is confirmed; turning it OFF is not. A speed bump in
 *    front of "make it safer again" is how a safety control gets left on.
 *  - Cancelling the confirm must not write. A dialog that flips the bit anyway
 *    is worse than no dialog.
 *  - A failed READ renders as its own "unknown" state. Reporting `off` for a
 *    state we could not read is the exact lie this control exists to prevent —
 *    the bypass is process-resident upstream and a gateway restart clears it
 *    with no event.
 *  - A gateway too old to have the endpoint renders nothing rather than a
 *    switch that cannot move.
 */

const yolo = vi.hoisted(() => ({
  state: {
    available: true,
    enabled: false,
    unsupported: false,
    unknown: false,
    pending: false,
    error: null as string | null,
    setEnabled: vi.fn((_next: boolean) => Promise.resolve()),
    refresh: vi.fn(),
  },
}))

const confirmMock = vi.hoisted(() => ({ answer: true, fn: vi.fn() }))

vi.mock('@/screens/chat/hooks/use-session-yolo', () => ({
  useSessionYolo: () => yolo.state,
}))

vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => ({
    confirm: (options: unknown) => {
      confirmMock.fn(options)
      return Promise.resolve(confirmMock.answer)
    },
    confirmDialog: null,
  }),
}))

const { ApprovalBypassToggle } = await import('./approval-bypass-toggle')

function reset() {
  yolo.state = {
    available: true,
    enabled: false,
    unsupported: false,
    unknown: false,
    pending: false,
    error: null,
    setEnabled: vi.fn(() => Promise.resolve()),
    refresh: vi.fn(),
  }
  confirmMock.answer = true
  confirmMock.fn.mockReset()
}

afterEach(() => {
  cleanup()
  reset()
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('ApprovalBypassToggle', () => {
  it('renders nothing when the gateway build has no bypass endpoint', () => {
    yolo.state.unsupported = true
    const { container } = render(<ApprovalBypassToggle sessionKey="sess-1" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when there is no gateway session to key on', () => {
    // A `new` chat before its first turn, or portable mode. A switch that
    // cannot address a session must not appear as one that can.
    yolo.state.available = false
    const { container } = render(<ApprovalBypassToggle sessionKey="new" />)
    expect(container.firstChild).toBeNull()
  })

  it('shows approvals as enforced by default and does not shout about it', () => {
    render(<ApprovalBypassToggle sessionKey="sess-1" />)
    const button = screen.getByTestId('approval-bypass-toggle')
    expect(button.getAttribute('data-state')).toBe('off')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.textContent).not.toContain('YOLO')
  })

  it('is loud and pressed once the bypass is on', () => {
    yolo.state.enabled = true
    render(<ApprovalBypassToggle sessionKey="sess-1" />)
    const button = screen.getByTestId('approval-bypass-toggle')
    expect(button.getAttribute('data-state')).toBe('on')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.textContent).toContain('YOLO')
  })

  it('confirms before enabling, and says the bypass is per-chat and unsaved', async () => {
    render(<ApprovalBypassToggle sessionKey="sess-1" />)
    fireEvent.click(screen.getByTestId('approval-bypass-toggle'))
    await flush()

    expect(confirmMock.fn).toHaveBeenCalledTimes(1)
    const options = confirmMock.fn.mock.calls[0][0] as {
      destructive?: boolean
    }
    expect(options.destructive).toBe(true)
    expect(yolo.state.setEnabled).toHaveBeenCalledWith(true)
  })

  it('writes nothing when the confirm is cancelled', async () => {
    confirmMock.answer = false
    render(<ApprovalBypassToggle sessionKey="sess-1" />)
    fireEvent.click(screen.getByTestId('approval-bypass-toggle'))
    await flush()

    expect(confirmMock.fn).toHaveBeenCalledTimes(1)
    expect(yolo.state.setEnabled).not.toHaveBeenCalled()
  })

  it('turns approvals back on with no confirm', async () => {
    yolo.state.enabled = true
    render(<ApprovalBypassToggle sessionKey="sess-1" />)
    fireEvent.click(screen.getByTestId('approval-bypass-toggle'))
    await flush()

    expect(confirmMock.fn).not.toHaveBeenCalled()
    expect(yolo.state.setEnabled).toHaveBeenCalledWith(false)
  })

  it('renders a failed read as unknown, never as "approvals are on"', async () => {
    yolo.state.unknown = true
    render(<ApprovalBypassToggle sessionKey="sess-1" />)
    const button = screen.getByTestId('approval-bypass-toggle')

    expect(button.getAttribute('data-state')).toBe('unknown')
    // No claim either way — `aria-pressed` is absent, not "false".
    expect(button.getAttribute('aria-pressed')).toBeNull()
    expect(button.getAttribute('aria-label')).toMatch(/unknown/i)

    fireEvent.click(button)
    await flush()
    expect(yolo.state.refresh).toHaveBeenCalled()
    expect(yolo.state.setEnabled).not.toHaveBeenCalled()
  })

  it('disables itself while a write is in flight', () => {
    yolo.state.pending = true
    render(<ApprovalBypassToggle sessionKey="sess-1" />)
    expect(
      screen.getByTestId('approval-bypass-toggle').getAttribute('disabled'),
    ).not.toBeNull()
  })
})
