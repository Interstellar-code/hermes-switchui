// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import * as toolEntries from '../components/v2/tool-entries'
import { useToolDisplay } from './use-tool-display'
import type { ChatMessage, StreamingToolCall } from '../types'

const STORAGE_KEY = 'switchui:tool-display-mode'
const EMPTY_MESSAGES: Array<ChatMessage> = []
const EMPTY_TOOL_CALLS: Array<StreamingToolCall> = []

describe('useToolDisplay', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  // ── localStorage lazy-init ─────────────────────────────────────────────────

  describe('toolDisplayMode lazy-init from localStorage', () => {
    it('adopts "expanded" when that value is stored', () => {
      localStorage.setItem(STORAGE_KEY, 'expanded')
      const { result } = renderHook(() =>
        useToolDisplay({
          realtimeMessages: EMPTY_MESSAGES,
          activeToolCalls: EMPTY_TOOL_CALLS,
        }),
      )
      expect(result.current.toolDisplayMode).toBe('expanded')
    })

    it('adopts "hidden" when that value is stored', () => {
      localStorage.setItem(STORAGE_KEY, 'hidden')
      const { result } = renderHook(() =>
        useToolDisplay({
          realtimeMessages: EMPTY_MESSAGES,
          activeToolCalls: EMPTY_TOOL_CALLS,
        }),
      )
      expect(result.current.toolDisplayMode).toBe('hidden')
    })

    it('defaults to "collapsed" when no stored value', () => {
      const { result } = renderHook(() =>
        useToolDisplay({
          realtimeMessages: EMPTY_MESSAGES,
          activeToolCalls: EMPTY_TOOL_CALLS,
        }),
      )
      expect(result.current.toolDisplayMode).toBe('collapsed')
    })

    it('defaults to "collapsed" when stored value is unrecognised', () => {
      localStorage.setItem(STORAGE_KEY, 'bogus')
      const { result } = renderHook(() =>
        useToolDisplay({
          realtimeMessages: EMPTY_MESSAGES,
          activeToolCalls: EMPTY_TOOL_CALLS,
        }),
      )
      expect(result.current.toolDisplayMode).toBe('collapsed')
    })
  })

  // ── cycleToolDisplayMode ───────────────────────────────────────────────────

  describe('cycleToolDisplayMode', () => {
    it('rotates expanded → collapsed → hidden → expanded', () => {
      localStorage.setItem(STORAGE_KEY, 'expanded')
      const { result } = renderHook(() =>
        useToolDisplay({
          realtimeMessages: EMPTY_MESSAGES,
          activeToolCalls: EMPTY_TOOL_CALLS,
        }),
      )
      expect(result.current.toolDisplayMode).toBe('expanded')

      act(() => {
        result.current.cycleToolDisplayMode()
      })
      expect(result.current.toolDisplayMode).toBe('collapsed')

      act(() => {
        result.current.cycleToolDisplayMode()
      })
      expect(result.current.toolDisplayMode).toBe('hidden')

      act(() => {
        result.current.cycleToolDisplayMode()
      })
      expect(result.current.toolDisplayMode).toBe('expanded')
    })

    it('persists each new mode to localStorage after every cycle', () => {
      localStorage.setItem(STORAGE_KEY, 'expanded')
      const { result } = renderHook(() =>
        useToolDisplay({
          realtimeMessages: EMPTY_MESSAGES,
          activeToolCalls: EMPTY_TOOL_CALLS,
        }),
      )

      act(() => {
        result.current.cycleToolDisplayMode()
      })
      expect(localStorage.getItem(STORAGE_KEY)).toBe('collapsed')

      act(() => {
        result.current.cycleToolDisplayMode()
      })
      expect(localStorage.getItem(STORAGE_KEY)).toBe('hidden')

      act(() => {
        result.current.cycleToolDisplayMode()
      })
      expect(localStorage.getItem(STORAGE_KEY)).toBe('expanded')
    })
  })

  // ── count memos ────────────────────────────────────────────────────────────

  describe('panelCounts', () => {
    const counts = (
      activeToolCalls: Array<StreamingToolCall>,
      extra: {
        mcpToolNames?: ReadonlySet<string>
        mcpServerNames?: Array<string>
        mcpToolServers?: ReadonlyMap<string, string>
      } = {},
      realtimeMessages: Array<ChatMessage> = EMPTY_MESSAGES,
    ) =>
      renderHook(() =>
        useToolDisplay({ realtimeMessages, activeToolCalls, ...extra }),
      ).result.current.panelCounts

    it('omits zero counts entirely', () => {
      expect(counts(EMPTY_TOOL_CALLS)).toEqual({})
    })

    it('empty todo list gives no todos badge', () => {
      const c = counts([
        { id: 't1', name: 'todo', phase: 'complete', args: { todos: [] } },
      ])
      expect(c.todos).toBeUndefined()
    })

    it('mcp counts bare tool names through the tool→server map', () => {
      const c = counts([{ id: 'b1', name: 'web_search_prime', phase: 'complete' }], {
        mcpToolNames: new Set(['web_search_prime']),
        mcpServerNames: ['zai'],
        mcpToolServers: new Map([['web_search_prime', 'zai']]),
      })
      expect(c.mcp).toEqual({ value: 1, label: '1 server' })
    })

    it('tools = calls incl. files, with a separate error count', () => {
      const c = counts([
        { id: 'tc1', name: 'Bash', phase: 'complete', result: 'ok' },
        { id: 'tc2', name: 'read_file', phase: 'complete', args: { path: 'a' }, result: 'ok' },
        { id: 'tc3', name: 'exec', phase: 'error', result: 'boom' },
      ])
      expect(c.tool?.value).toBe(3)
      expect(c.tool?.errors).toBe(1)
      expect(c.tool?.label).toBe('3 calls, 1 error')
    })

    it('todos = done/total of the latest snapshot', () => {
      const c = counts([
        {
          id: 't1',
          name: 'todo',
          phase: 'complete',
          args: {
            todos: [
              { id: '1', content: 'a', status: 'completed' },
              { id: '2', content: 'b', status: 'in_progress' },
              { id: '3', content: 'c', status: 'pending' },
            ],
          },
        },
      ])
      expect(c.todos).toEqual({ value: '1/3', label: '1 of 3 done' })
    })

    it('mcp = distinct servers used', () => {
      const c = counts(
        [
          { id: 'm1', name: 'mcp__github__search', phase: 'complete' },
          { id: 'm2', name: 'mcp__github__get', phase: 'complete' },
          { id: 'm3', name: 'mcp__trek__list', phase: 'complete' },
        ],
        { mcpServerNames: ['github', 'trek'] },
      )
      expect(c.mcp).toEqual({ value: 2, label: '2 servers' })
    })

    it('skills = distinct skills used (skills_list excluded)', () => {
      const c = counts([
        { id: 's1', name: 'skill_view', phase: 'complete', args: { name: 'a' } },
        { id: 's2', name: 'skill_view', phase: 'complete', args: { name: 'a' } },
        { id: 's3', name: 'skill_view', phase: 'complete', args: { name: 'b' } },
        { id: 's4', name: 'skills_list', phase: 'complete' },
      ])
      expect(c.skills).toEqual({ value: 2, label: '2 used' })
    })

    it('recomputes when activeToolCalls prop changes', () => {
      const { result, rerender } = renderHook(
        (props: {
          realtimeMessages: Array<ChatMessage>
          activeToolCalls: Array<StreamingToolCall>
        }) => useToolDisplay(props),
        {
          initialProps: {
            realtimeMessages: EMPTY_MESSAGES,
            activeToolCalls: EMPTY_TOOL_CALLS,
          },
        },
      )
      expect(result.current.panelCounts.tool).toBeUndefined()
      rerender({
        realtimeMessages: EMPTY_MESSAGES,
        activeToolCalls: [{ id: 'tc1', name: 'Bash', phase: 'streaming' }],
      })
      expect(result.current.panelCounts.tool?.value).toBe(1)
    })
  })

  describe('shared tool entries', () => {
    it('merges once per input change and derives every count from toolEntries', () => {
      const spy = vi.spyOn(toolEntries, 'mergeToolEntries')
      const calls1: Array<StreamingToolCall> = [
        { id: 'sk1', name: 'skill_view', phase: 'complete' },
        { id: 'rf1', name: 'read_file', phase: 'complete', args: { path: 'a' } },
      ]
      const { result, rerender } = renderHook((props) => useToolDisplay(props), {
        initialProps: { realtimeMessages: EMPTY_MESSAGES, activeToolCalls: calls1 },
      })
      expect(spy).toHaveBeenCalledTimes(1)
      expect(result.current.toolEntries).toHaveLength(2)
      expect(result.current.panelCounts.skills?.value).toBe(1)
      expect(result.current.panelCounts.tool?.value).toBe(2)

      rerender({ realtimeMessages: EMPTY_MESSAGES, activeToolCalls: calls1 })
      expect(spy).toHaveBeenCalledTimes(1)

      rerender({ realtimeMessages: EMPTY_MESSAGES, activeToolCalls: [...calls1] })
      expect(spy).toHaveBeenCalledTimes(2)
      spy.mockRestore()
    })
  })
})
