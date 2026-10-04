import { describe, expect, it } from 'vitest'

import {
  buildResultTsMap,
  categorizeEntry,
  detectToolError,
  extractStreamToolCallsFromMessages,
  extractStreamingEntries,
  extractToolEntries,
  filterToolEntries,
  latestTodoSnapshot,
  mcpServerOf,
  mergeToolEntries,
} from './tool-entries'
import type { FlatToolEntry } from './tool-entries'
import type { ChatMessage } from '../../types'

function merged(messages: Array<ChatMessage>): Array<FlatToolEntry> {
  return mergeToolEntries(
    extractStreamingEntries([]),
    extractStreamToolCallsFromMessages(messages, buildResultTsMap(messages)),
    extractToolEntries(messages),
  )
}

/**
 * Exact shape toChatMessage (src/server/hermes-api.ts) emits for history:
 * assistant message with a toolCall content block + streamToolCalls (phase
 * 'complete', no result), followed by a role:'tool' message carrying a
 * tool_result block.
 */
function historyPair(opts: {
  id: string
  name: string
  args: Record<string, unknown>
  output: string
  ts?: number
}): Array<ChatMessage> {
  const ts = opts.ts ?? 1_700_000_000
  const argsJson = JSON.stringify(opts.args)
  return [
    {
      id: `msg-${opts.id}-a`,
      role: 'assistant',
      content: [
        { type: 'toolCall', id: opts.id, name: opts.name, arguments: opts.args, partialJson: argsJson },
      ],
      text: '',
      timestamp: ts * 1000,
      createdAt: new Date(ts * 1000).toISOString(),
      sessionKey: 's1',
      streamToolCalls: [{ id: opts.id, name: opts.name, args: argsJson, phase: 'complete' }],
    },
    {
      id: `msg-${opts.id}-t`,
      role: 'tool',
      content: [{ type: 'tool_result', toolCallId: opts.id, toolName: opts.name, text: opts.output }],
      text: opts.output,
      timestamp: (ts + 1) * 1000,
      createdAt: new Date((ts + 1) * 1000).toISOString(),
      sessionKey: 's1',
    },
  ] as unknown as Array<ChatMessage>
}

describe('mergeToolEntries with real history shape (B1)', () => {
  it('keeps the tool_result output instead of the empty streamToolCalls output', () => {
    const [entry] = merged(
      historyPair({ id: 'c1', name: 'read_file', args: { path: 'a.ts' }, output: '{"content":"hi"}' }),
    )
    expect(entry.output).toBe('{"content":"hi"}')
    expect(entry.isError).toBe(false)
    expect(entry.displayTs).toBe(1_700_000_001_000)
  })

  it('keeps isError detected on the tool_result', () => {
    const [entry] = merged(
      historyPair({ id: 'c2', name: 'execute_code', args: { code: 'x' }, output: '{"status":"error","error":"BLOCKED"}' }),
    )
    expect(entry.output).toContain('BLOCKED')
    expect(entry.isError).toBe(true)
  })

  it('a later non-empty output still wins', () => {
    const base: FlatToolEntry = { key: 'k', isCall: true, name: 't', callId: 'k', output: 'old' }
    const [entry] = mergeToolEntries([{ ...base, output: 'new' }], [], [base])
    expect(entry.output).toBe('new')
  })

  it('ORs isError across sources for the same callId', () => {
    const base: FlatToolEntry = { key: 'k', isCall: true, name: 't', callId: 'k', output: 'x' }
    const [fromMessage] = mergeToolEntries([], [{ ...base, output: 'y' }], [{ ...base, isError: true }])
    expect(fromMessage.isError).toBe(true)
    const [fromStream] = mergeToolEntries([{ ...base, output: 'y', isError: true }], [base], [])
    expect(fromStream.isError).toBe(true)
  })
})

describe('detectToolError (B2)', () => {
  it('flags structured errors', () => {
    expect(detectToolError('{"error":"x"}', 'terminal')).toBe(true)
    expect(detectToolError('{"status":"error"}', 'anything')).toBe(true)
    expect(detectToolError('{"output":"","exit_code":2}', 'terminal')).toBe(true)
    expect(detectToolError('{"output":"","exit_code":1}', 'terminal', { command: 'ls nope' })).toBe(true)
  })

  it('does not flag success or plain text', () => {
    expect(detectToolError('{"output":"ok","exit_code":0,"error":null}', 'terminal')).toBe(false)
    expect(detectToolError('{"error":""}', 'terminal')).toBe(false)
    expect(detectToolError('there was an error in the log', 'terminal')).toBe(false)
    expect(detectToolError('', 'terminal')).toBe(false)
    expect(detectToolError(undefined, 'terminal')).toBe(false)
  })

  it('treats search exit 1 as no matches', () => {
    expect(detectToolError('{"exit_code":1}', 'grep')).toBe(false)
    expect(detectToolError('{"exit_code":1}', 'search_files')).toBe(false)
    expect(detectToolError('{"exit_code":1}', 'terminal', { command: 'rg foo src' })).toBe(false)
    expect(detectToolError('{"exit_code":1}', 'terminal', { value: '{"command":" grep -n x f"}' })).toBe(false)
    expect(detectToolError('{"exit_code":2}', 'grep')).toBe(true)
  })

  it('matches grep/rg after a pipe, && or ;', () => {
    const cmd = (command: string) => detectToolError('{"exit_code":1}', 'terminal', { command })
    expect(cmd('cat f | grep x')).toBe(false)
    expect(cmd('cd src && rg foo')).toBe(false)
    expect(cmd('cd src; grep -r foo .')).toBe(false)
    expect(cmd('python3 grep_tool.py')).toBe(true)
  })

  it('flags a non-empty object error, ignores empty ones', () => {
    expect(detectToolError('{"error":{"code":500}}', 'terminal')).toBe(true)
    expect(detectToolError('{"error":{}}', 'terminal')).toBe(false)
  })

  it('only parses JSON objects, and skips huge outputs without error fields', () => {
    expect(detectToolError('["error"]', 'terminal')).toBe(false)
    expect(detectToolError(`  {"exit_code":3}`, 'terminal')).toBe(true)
    const pad = 'x'.repeat(70 * 1024)
    expect(detectToolError(`{"output":"${pad}"}`, 'terminal')).toBe(false)
    expect(detectToolError(`{"output":"${pad}","exit_code":2}`, 'terminal')).toBe(true)
  })

  it('respects an explicit isError over detection', () => {
    const msgs = [
      { role: 'assistant', content: [{ type: 'toolCall', id: 'e1', name: 'terminal', arguments: {} }] },
      { role: 'tool', toolCallId: 'e1', isError: false, content: [{ type: 'text', text: '{"exit_code":2}' }] },
    ] as unknown as Array<ChatMessage>
    expect(extractToolEntries(msgs)[0].isError).toBe(false)
  })
})

describe('categorizeEntry (B4)', () => {
  const cat = (name: string, input?: Record<string, unknown>) =>
    categorizeEntry({ key: name, isCall: true, name, callId: name, input })

  it('tokenises names', () => {
    expect(cat('execute_code', { code: 'print(1)' })).toBe('code')
    expect(cat('read_file')).toBe('file')
    expect(cat('patch')).toBe('file')
    expect(cat('web_search')).toBe('search')
    expect(cat('browser_navigate')).toBe('web')
    expect(cat('mnemosyne_recall')).toBe('memory')
    expect(cat('terminal', { command: 'ls' })).toBe('exec')
    expect(cat('cronjob')).toBe('cron')
    expect(cat('vision_analyze')).toBe('other')
    expect(cat('mcp_context_mode_ctx_execute')).toBe('mcp')
    expect(cat('mcp__trek__search_place', { query: 'x' })).toBe('mcp')
    expect(cat('load_mcp_tools')).toBe('mcp')
    expect(cat('github_search', { query: 'x' })).toBe('search')
    expect(
      categorizeEntry(
        { key: 'g', isCall: true, name: 'github_search', callId: 'g', input: { query: 'x' } },
        new Set(['github_search']),
      ),
    ).toBe('mcp')
  })
})

describe('filterToolEntries (Q1)', () => {
  it("'all' includes file entries but not todo/mcp", () => {
    const e = (name: string): FlatToolEntry => ({ key: name, isCall: true, name, callId: name })
    const names = filterToolEntries([e('read_file'), e('todo'), e('mcp__x__y'), e('terminal')], 'all').map((x) => x.name)
    expect(names).toEqual(['read_file', 'terminal'])
  })
})

describe('latestTodoSnapshot', () => {
  it('uses the full list from the output of a merge-mode call', () => {
    const output = JSON.stringify({
      todos: [
        { id: '1', content: 'one', status: 'completed' },
        { id: '2', content: 'two', status: 'in_progress' },
        { id: '3', content: 'three', status: 'pending' },
      ],
      summary: { total: 3, completed: 1 },
    })
    const msgs = [
      ...historyPair({ id: 't1', name: 'todo', args: { todos: [{ id: '1', content: 'one', status: 'pending' }] }, output: '{"todos":[]}', ts: 100 }),
      ...historyPair({ id: 't2', name: 'todo', args: { todos: [{ id: '1', status: 'completed' }], merge: true }, output, ts: 200 }),
    ]
    const snap = latestTodoSnapshot(merged(msgs))
    expect(snap?.todos.map((t) => t.content)).toEqual(['one', 'two', 'three'])
    expect(snap?.summary).toEqual({ total: 3, completed: 1 })
  })

  it('uses args only when merge is not true, never an older call', () => {
    const e = (key: string, input: Record<string, unknown>, timestamp: number): FlatToolEntry => ({
      key, isCall: true, name: 'todo', callId: key, input, timestamp,
    })
    const full = e('a', { todos: [{ content: 'full', status: 'pending' }] }, 1)
    const partial = e('b', { todos: [{ content: 'partial', status: 'completed' }], merge: true }, 2)
    expect(latestTodoSnapshot([full])?.todos.map((t) => t.content)).toEqual(['full'])
    expect(latestTodoSnapshot([full, partial])).toBeNull()
    expect(latestTodoSnapshot([partial])).toBeNull()
    // Newest is merge-mode with unparseable output: no stale fallback.
    expect(latestTodoSnapshot([full, { ...partial, output: 'not json' }])).toBeNull()
    expect(latestTodoSnapshot([])).toBeNull()
  })
})

describe('mcpServerOf', () => {
  it('resolves double- and single-underscore names', () => {
    expect(mcpServerOf('mcp__trek__get_weather', [])).toBe('trek')
    expect(mcpServerOf('mcp_context_mode_ctx_execute', ['context', 'context-mode'])).toBe('context-mode')
    expect(mcpServerOf('mcp_brave_brave_web_search', ['brave'])).toBe('brave')
    expect(mcpServerOf('mcp_unknown_tool', ['brave'])).toBe('other')
    expect(mcpServerOf('terminal', ['brave'])).toBe('other')
    expect(mcpServerOf('mcp_context_mode_ctx_execute', ['context-mode'])).toBe('context-mode')
    expect(mcpServerOf('mcp_my_server_do_thing', ['My-Server'])).toBe('my-server')
    expect(mcpServerOf('mcp__my_server__do_thing', ['my-server'])).toBe('my-server')
  })
})
