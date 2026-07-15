import { describe, expect, it } from 'vitest'
import {
  buildToolCallChatDelegations,
  delegationToEntry,
  extractDelegateTaskToolCalls,
  getVisibleChatDelegations,
  mergeChatDelegations,
} from './chat-delegations'
import type { Delegation } from '../../server/delegations'
import type { ChatMessage } from './types'

function delegation(overrides: Partial<Delegation>): Delegation {
  return {
    childSessionId: 'child-1',
    goal: 'Check the gateway status',
    model: 'gpt-4',
    status: 'running',
    inputTokens: 0,
    outputTokens: 0,
    startedAt: 1_000,
    endedAt: null,
    ...overrides,
  }
}

describe('delegationToEntry', () => {
  it('maps a running delegation to an entry with null endedAt', () => {
    const entry = delegationToEntry(delegation({}), 31_000)
    expect(entry).toMatchObject({
      id: 'child-1',
      childSessionKey: 'child-1',
      status: 'running',
      task: 'Check the gateway status',
      label: 'gpt-4',
      endedAt: null,
      elapsedMs: 30_000,
    })
  })
})

describe('getVisibleChatDelegations', () => {
  it('hides completed and failed delegations from the active strip', () => {
    const now = 1_700_000_200_000
    const entries = [
      delegationToEntry(
        delegation({
          childSessionId: 'failed-child',
          status: 'failed',
          startedAt: now - 100_000,
          endedAt: now - 10_000,
        }),
        now,
      ),
      delegationToEntry(
        delegation({
          childSessionId: 'old-child',
          status: 'completed',
          startedAt: now - 240_000,
          endedAt: now - 180_000,
        }),
        now,
      ),
    ]

    expect(getVisibleChatDelegations(entries, now)).toEqual([])
  })

  it('always shows running/spawned entries regardless of age', () => {
    const now = 1_700_000_200_000
    const entries = [
      delegationToEntry(
        delegation({ childSessionId: 'stale-running', status: 'running', startedAt: now - 1_000_000 }),
        now,
      ),
    ]
    expect(getVisibleChatDelegations(entries, now)).toHaveLength(1)
  })
})

describe('buildToolCallChatDelegations', () => {
  it('derives a spawned/running card from a delegate_task tool call', () => {
    const entries = buildToolCallChatDelegations({
      now: 5_000,
      existingDelegations: [],
      toolCalls: [
        {
          id: 'tc-1',
          name: 'delegate_task',
          phase: 'running',
          args: { agent: 'neo', goal: 'Monitor the Hermes gateway for regressions.' },
          preview: 'Monitor the Hermes gateway for regressions.',
        },
      ],
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      id: 'tool-tc-1',
      childSessionKey: '',
      agentName: 'neo',
      status: 'running',
      task: 'Monitor the Hermes gateway for regressions.',
    })
  })

  it('ignores tool calls that are not delegate_task', () => {
    const entries = buildToolCallChatDelegations({
      existingDelegations: [],
      toolCalls: [{ id: 'tc-2', name: 'read_file', phase: 'running' }],
    })
    expect(entries).toHaveLength(0)
  })

  it('dedupes a tool call against a session delegation with a matching task', () => {
    const now = 5_000
    const existing = [
      delegationToEntry(
        delegation({
          childSessionId: 'child-9',
          status: 'running',
          goal: 'Monitor the Hermes gateway for regressions.',
        }),
        now,
      ),
    ]
    const entries = buildToolCallChatDelegations({
      now,
      existingDelegations: existing,
      toolCalls: [
        {
          id: 'tc-3',
          name: 'delegate_task',
          phase: 'running',
          args: { goal: 'Monitor the Hermes gateway for regressions.' },
        },
      ],
    })
    expect(entries).toHaveLength(0)
  })
})

describe('mergeChatDelegations', () => {
  it('merges the session half and the tool-call half, sorted newest first', () => {
    const now = 10_000
    const entries = mergeChatDelegations({
      now,
      delegations: [delegation({ childSessionId: 'child-1', startedAt: 1_000 })],
      toolCalls: [
        {
          id: 'tc-1',
          name: 'delegate_task',
          phase: 'running',
          args: { goal: 'A brand new spawned task with no session yet.' },
        },
      ],
    })

    expect(entries).toHaveLength(2)
    expect(entries[0].id).toBe('tool-tc-1')
    expect(entries[1].id).toBe('child-1')
  })

  it('returns an empty list when there is nothing to show', () => {
    expect(mergeChatDelegations({ delegations: [], toolCalls: [] })).toEqual([])
  })
})

describe('extractDelegateTaskToolCalls', () => {
  function assistantMessageWithDelegateTask(overrides: {
    callId: string
    goal: string
    result?: { text: string; isError?: boolean }
  }): Array<ChatMessage> {
    const messages: Array<ChatMessage> = [
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: overrides.callId,
            name: 'delegate_task',
            arguments: { tasks: [{ goal: overrides.goal }] },
          },
        ],
      },
    ]
    if (overrides.result) {
      messages.push({
        role: 'toolResult',
        toolCallId: overrides.callId,
        content: [{ type: 'text', text: overrides.result.text }],
        isError: overrides.result.isError ?? false,
      })
    }
    return messages
  }

  it('surfaces a running delegate_task card from the persisted transcript with no result yet', () => {
    const messages = assistantMessageWithDelegateTask({
      callId: 'call-1',
      goal: 'Investigate the flaky gateway test.',
    })

    const merged = mergeChatDelegations({
      delegations: [],
      toolCalls: extractDelegateTaskToolCalls(messages, []),
    })
    const visible = getVisibleChatDelegations(merged)

    expect(visible).toHaveLength(1)
    expect(visible[0]).toMatchObject({
      status: 'running',
      task: 'Investigate the flaky gateway test.',
    })
  })

  it('keeps a completed delegate_task in merged history but hides it from the strip', () => {
    const messages = assistantMessageWithDelegateTask({
      callId: 'call-2',
      goal: 'Summarize the release notes.',
      result: { text: 'Done.' },
    })

    const merged = mergeChatDelegations({
      delegations: [],
      toolCalls: extractDelegateTaskToolCalls(messages, []),
    })
    const visible = getVisibleChatDelegations(merged)

    expect(merged[0]).toMatchObject({
      status: 'completed',
      task: 'Summarize the release notes.',
    })
    expect(visible).toEqual([])
  })

  it('dedupes an activeToolCalls entry already represented in the persisted transcript', () => {
    const messages = assistantMessageWithDelegateTask({
      callId: 'call-3',
      goal: 'Refactor the auth middleware.',
    })

    const result = extractDelegateTaskToolCalls(messages, [
      { id: 'call-3', name: 'delegate_task', phase: 'calling' },
    ])

    expect(result).toHaveLength(1)
    expect(result[0].phase).toBe('running')
  })
})
