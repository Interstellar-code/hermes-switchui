// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'

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

  describe('totalToolCount', () => {
    it('is 0 with empty messages and tool calls', () => {
      const { result } = renderHook(() =>
        useToolDisplay({
          realtimeMessages: EMPTY_MESSAGES,
          activeToolCalls: EMPTY_TOOL_CALLS,
        }),
      )
      expect(result.current.totalToolCount).toBe(0)
    })

    it('counts general tools separately from file calls', () => {
      const activeToolCalls: Array<StreamingToolCall> = [
        { id: 'tc1', name: 'Bash', phase: 'streaming' },
        { id: 'tc2', name: 'Read', phase: 'streaming' },
      ]
      const { result } = renderHook(() =>
        useToolDisplay({
          realtimeMessages: EMPTY_MESSAGES,
          activeToolCalls,
        }),
      )
      expect(result.current.totalToolCount).toBe(1)
      expect(result.current.totalFileCount).toBe(1)
    })

    it('excludes to-dos and MCP calls represented in their own tabs', () => {
      const activeToolCalls: Array<StreamingToolCall> = [
        { id: 'todo-1', name: 'todo', phase: 'streaming' },
        { id: 'mcp-1', name: 'mcp__github__search', phase: 'streaming' },
        { id: 'exec-1', name: 'exec', phase: 'streaming' },
      ]
      const { result } = renderHook(() =>
        useToolDisplay({
          realtimeMessages: EMPTY_MESSAGES,
          activeToolCalls,
        }),
      )

      expect(result.current.totalToolCount).toBe(1)
      expect(result.current.totalTodoCount).toBe(1)
      expect(result.current.totalMcpCount).toBe(1)
    })

    it('excludes file calls represented in the Files tab', () => {
      const activeToolCalls: Array<StreamingToolCall> = [
        { id: 'read-1', name: 'read_file', phase: 'streaming', args: { file_path: 'src/app.tsx' } },
        { id: 'exec-1', name: 'exec', phase: 'streaming' },
      ]
      const { result } = renderHook(() =>
        useToolDisplay({
          realtimeMessages: EMPTY_MESSAGES,
          activeToolCalls,
        }),
      )

      expect(result.current.totalToolCount).toBe(1)
      expect(result.current.totalFileCount).toBe(1)
    })

    it('counts completed general and file calls in their respective tabs', () => {
      const realtimeMessages: Array<ChatMessage> = [
        {
          role: 'assistant',
          content: [
            { type: 'toolCall', id: 'm1', name: 'Bash', arguments: {} },
            { type: 'toolCall', id: 'm2', name: 'Read', arguments: {} },
          ],
        },
      ]
      const { result } = renderHook(() =>
        useToolDisplay({
          realtimeMessages,
          activeToolCalls: EMPTY_TOOL_CALLS,
        }),
      )
      expect(result.current.totalToolCount).toBe(1)
      expect(result.current.totalFileCount).toBe(1)
    })

    it('recomputes when realtimeMessages prop changes', () => {
      const oneCall: Array<ChatMessage> = [
        {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'm1', name: 'Bash', arguments: {} }],
        },
      ]
      const twoCalls: Array<ChatMessage> = [
        {
          role: 'assistant',
          content: [
            { type: 'toolCall', id: 'm1', name: 'Bash', arguments: {} },
            { type: 'toolCall', id: 'm2', name: 'Read', arguments: {} },
          ],
        },
      ]
      const { result, rerender } = renderHook(
        (props: {
          realtimeMessages: Array<ChatMessage>
          activeToolCalls: Array<StreamingToolCall>
        }) => useToolDisplay(props),
        {
          initialProps: {
            realtimeMessages: oneCall,
            activeToolCalls: EMPTY_TOOL_CALLS,
          },
        },
      )
      expect(result.current.totalToolCount).toBe(1)

      rerender({ realtimeMessages: twoCalls, activeToolCalls: EMPTY_TOOL_CALLS })
      expect(result.current.totalToolCount).toBe(1)
      expect(result.current.totalFileCount).toBe(1)
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
      expect(result.current.totalToolCount).toBe(0)

      rerender({
        realtimeMessages: EMPTY_MESSAGES,
        activeToolCalls: [{ id: 'tc1', name: 'Bash', phase: 'streaming' }],
      })
      expect(result.current.totalToolCount).toBe(1)
    })
  })

  describe('totalSkillCount', () => {
    it('is 0 with empty messages and tool calls', () => {
      const { result } = renderHook(() =>
        useToolDisplay({
          realtimeMessages: EMPTY_MESSAGES,
          activeToolCalls: EMPTY_TOOL_CALLS,
        }),
      )
      expect(result.current.totalSkillCount).toBe(0)
    })

    it('counts streaming skill tool calls by name', () => {
      const activeToolCalls: Array<StreamingToolCall> = [
        { id: 'sk1', name: 'skill', phase: 'streaming' },
        { id: 'sk2', name: 'skills_list', phase: 'streaming' },
      ]
      const { result } = renderHook(() =>
        useToolDisplay({
          realtimeMessages: EMPTY_MESSAGES,
          activeToolCalls,
        }),
      )
      expect(result.current.totalSkillCount).toBe(2)
    })

    it('recomputes when props change', () => {
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
      expect(result.current.totalSkillCount).toBe(0)

      rerender({
        realtimeMessages: EMPTY_MESSAGES,
        activeToolCalls: [{ id: 'sk1', name: 'skill', phase: 'streaming' }],
      })
      expect(result.current.totalSkillCount).toBe(1)
    })
  })

  describe('todo and MCP counts', () => {
    it('separates todo and configured MCP calls', () => {
      const { result } = renderHook(() =>
        useToolDisplay({
          realtimeMessages: EMPTY_MESSAGES,
          activeToolCalls: [
            { id: 'todo-1', name: 'todo', phase: 'complete' },
            { id: 'mcp-1', name: 'github_search', phase: 'complete' },
            { id: 'bash-1', name: 'bash', phase: 'complete' },
          ],
          mcpToolNames: new Set(['github_search']),
        }),
      )
      expect(result.current.totalTodoCount).toBe(1)
      expect(result.current.totalMcpCount).toBe(1)
    })
  })

  // ── activeTab ──────────────────────────────────────────────────────────────

  describe('activeTab', () => {
    it('defaults to "chat"', () => {
      const { result } = renderHook(() =>
        useToolDisplay({
          realtimeMessages: EMPTY_MESSAGES,
          activeToolCalls: EMPTY_TOOL_CALLS,
        }),
      )
      expect(result.current.activeTab).toBe('chat')
    })
  })
})
