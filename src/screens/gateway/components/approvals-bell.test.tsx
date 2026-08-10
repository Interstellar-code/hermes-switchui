// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The bell is a POINTER. It counts approvals and navigates to the card, and it
 * must never resolve one — a second resolve surface races the card for a queue
 * the gateway pops FIFO, and a dropdown has none of the context (command,
 * pattern keys, expiry) a security decision needs.
 */

const nav = vi.hoisted(() => ({ navigate: vi.fn() }))
const queue = vi.hoisted(() => ({ value: { approvals: [] as Array<unknown>, count: 0, unsupported: false } }))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => nav.navigate,
}))

vi.mock('@/hooks/use-approval-queue', () => ({
  usePendingApprovalQueue: () => queue.value,
  approvalSessionKey: (entry: { sessionId: string }) => entry.sessionId,
}))

const { ApprovalsBell } = await import('./approvals-bell')

const entry = (over: Record<string, unknown> = {}) => ({
  clarifyId: 'approval_1',
  sessionId: 'sess-a',
  choices: ['once', 'deny'],
  question: 'delete temp dir',
  approval: { runId: 'run_1111', command: 'rm -rf /tmp/demo' },
  ...over,
})

afterEach(() => {
  cleanup()
  nav.navigate.mockReset()
  queue.value = { approvals: [], count: 0, unsupported: false }
})

describe('ApprovalsBell', () => {
  it('renders nothing when nothing is waiting', () => {
    const { container } = render(<ApprovalsBell />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the pending count', () => {
    queue.value = { approvals: [entry(), entry({ clarifyId: 'a2' })], count: 2, unsupported: false }
    render(<ApprovalsBell />)
    expect(screen.getByRole('button', { name: /2 pending/ })).toBeTruthy()
  })

  it('navigates to the blocked chat instead of deciding', () => {
    queue.value = { approvals: [entry()], count: 1, unsupported: false }
    render(<ApprovalsBell />)

    fireEvent.click(screen.getByRole('button', { name: /1 pending/ }))
    fireEvent.click(screen.getByText('delete temp dir'))

    expect(nav.navigate).toHaveBeenCalledWith({
      to: '/chat/$sessionKey',
      params: { sessionKey: 'sess-a' },
    })
  })

  it('exposes no approve or deny affordance anywhere in the popover', () => {
    queue.value = { approvals: [entry()], count: 1, unsupported: false }
    render(<ApprovalsBell />)
    fireEvent.click(screen.getByRole('button', { name: /1 pending/ }))

    const labels = screen
      .getAllByRole('button')
      .map((node) => node.textContent)
      .join(' | ')
    expect(labels).not.toMatch(/approve/i)
    expect(labels).not.toMatch(/\bdeny\b/i)
    expect(labels).not.toMatch(/allow/i)
  })
})
