// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChatMessageList } from './components/chat-message-list'
import { DelegationCardActions } from './components/delegation-completion-card'
import {
  formatDelegationDuration,
  parseDelegationCompletion,
} from './delegation-completion'
import type { ChatMessage } from './types'

afterEach(cleanup)

// Shape of a real gateway envelope (state.db row 156197, trimmed).
const BATCH = `[ASYNC DELEGATION BATCH COMPLETE — deleg_865f38ff]
A background fan-out unit you dispatched earlier — 3 subagent(s) — has finished; its consolidated results are below.

Dispatched: 2026-10-03 16:43:54 (10m56s ago)
Role: leaf   Model: ?   Total duration: 656.52s

--- ✓ TASK 1/3: Architecture comparison (status=completed, 464.96s) ---
first result
--- ✓ TASK 2/3: Second (status=completed) ---
second result
--- ✗ TASK 3/3: Third (status=failed) ---
boom`

function row(text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'user',
    text,
    content: [{ type: 'text', text }],
    timestamp: 1,
    ...extra,
  }
}

describe('parseDelegationCompletion', () => {
  it('prefers display_metadata when the gateway passes it', () => {
    const parsed = parseDelegationCompletion(
      row('anything', {
        displayKind: 'async_delegation_complete',
        displayMetadata: {
          delegation_id: 'deleg_meta',
          task_count: 4,
          completed_count: 3,
          failed_count: 1,
          duration_seconds: 61,
        },
      }),
    )
    expect(parsed).toMatchObject({
      delegationId: 'deleg_meta',
      taskCount: 4,
      completedCount: 3,
      failedCount: 1,
      durationSeconds: 61,
      body: 'anything',
    })
  })

  it('falls back to parsing the envelope header and task sections', () => {
    const parsed = parseDelegationCompletion(
      row(BATCH, { displayKind: 'async_delegation_complete' }),
    )
    expect(parsed).toMatchObject({
      delegationId: 'deleg_865f38ff',
      isTaskFailure: false,
      taskCount: 3,
      completedCount: 2,
      failedCount: 1,
      durationSeconds: 656.52,
    })
  })

  it('matches by text prefix alone (telegram / older gateways)', () => {
    expect(parseDelegationCompletion(row(BATCH))?.delegationId).toBe(
      'deleg_865f38ff',
    )
    const failure = parseDelegationCompletion(
      row('[ASYNC DELEGATION TASK FAILED — deleg_d1, task 2/3]\nOne subagent…'),
    )
    expect(failure).toMatchObject({
      delegationId: 'deleg_d1',
      isTaskFailure: true,
      failedCount: 1,
    })
  })

  it('returns null for ordinary or quoted user text', () => {
    expect(parseDelegationCompletion(row('hello'))).toBeNull()
    expect(parseDelegationCompletion(row(`> [Quote] > ${BATCH}`))).toBeNull()
  })

  it('tolerates a malformed envelope', () => {
    const parsed = parseDelegationCompletion(
      row('[ASYNC DELEGATION BATCH COMPLETE — ]'),
    )
    expect(parsed).toMatchObject({
      delegationId: null,
      taskCount: null,
      completedCount: null,
      failedCount: null,
      durationSeconds: null,
    })
  })

  it('formats durations', () => {
    expect(formatDelegationDuration(656.52)).toBe('10m 56s')
    expect(formatDelegationDuration(42)).toBe('42s')
    expect(formatDelegationDuration(3700)).toBe('1h 1m')
  })
})

function ensureMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

function tagged(id: string, text = BATCH): ChatMessage {
  const message = row(text, { id })
  message.__delegationComplete = parseDelegationCompletion(message)!
  return message
}

function renderList(messages: Array<ChatMessage>, actions?: React.ReactNode) {
  ensureMatchMedia()
  return render(
    <ChatMessageList
      messages={messages}
      loading={false}
      empty={false}
      waitingForResponse={false}
      pinToTop={false}
      pinGroupMinHeight={0}
      headerHeight={0}
      delegationActions={actions}
    />,
  )
}

describe('DelegationCompletionCard in the message list', () => {
  it('renders collapsed, not as a user bubble, and expands on click', () => {
    const { getByTestId, queryByTestId, container } = renderList([
      tagged('msg-1'),
    ])
    const card = getByTestId('delegation-completion-card')
    expect(card.textContent).toContain('Background delegation finished')
    expect(card.textContent).toContain('2/3 tasks')
    expect(getByTestId('delegation-failed-count').textContent).toContain(
      '1 failed',
    )
    expect(card.textContent).toContain('10m 56s')
    // Collapsed: the 9 KB body is not in the DOM.
    expect(queryByTestId('delegation-completion-body')).toBeNull()
    // Not a right-aligned user bubble.
    const wrapper = container.querySelector('[data-chat-message-role="user"]')
    expect(wrapper?.className).not.toContain('items-end')

    const toggle = card.querySelector('button[aria-expanded]')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(getByTestId('delegation-completion-body').textContent).toContain(
      'second result',
    )
  })

  it('shows the actions only on the last message', () => {
    const actions = <span data-testid="deleg-actions">actions</span>
    const twoCards = renderList([tagged('msg-1'), tagged('msg-2')], actions)
    expect(twoCards.getAllByTestId('deleg-actions')).toHaveLength(1)
    const cards = twoCards.getAllByTestId('delegation-completion-card')
    expect(cards[1]?.textContent).toContain('actions')
    cleanup()

    const followed = renderList(
      [
        tagged('msg-1'),
        {
          id: 'a1',
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
          timestamp: 2,
        },
      ],
      actions,
    )
    expect(followed.queryByTestId('deleg-actions')).toBeNull()
  })
})

describe('DelegationCardActions', () => {
  it('hides Continue while the chat is busy but keeps the toggle', () => {
    const onContinue = vi.fn()
    const { queryByTestId, getByTestId, rerender } = render(
      <DelegationCardActions
        canContinue={false}
        onContinue={onContinue}
        autoContinue={false}
        onAutoContinueChange={() => {}}
      />,
    )
    expect(queryByTestId('delegation-continue')).toBeNull()
    expect(getByTestId('delegation-auto-continue')).toBeTruthy()

    rerender(
      <DelegationCardActions
        canContinue
        onContinue={onContinue}
        autoContinue={false}
        onAutoContinueChange={() => {}}
      />,
    )
    fireEvent.click(getByTestId('delegation-continue'))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('reports toggle changes', () => {
    const onChange = vi.fn()
    const { getByTestId } = render(
      <DelegationCardActions
        canContinue
        onContinue={() => {}}
        autoContinue={false}
        onAutoContinueChange={onChange}
      />,
    )
    fireEvent.click(getByTestId('delegation-auto-continue'))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
