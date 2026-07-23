import { useCallback, useMemo, useState } from 'react'

import {
  buildResultTsMap,
  extractStreamToolCallsFromMessages,
  extractStreamingEntries,
  extractToolEntries,
  filterToolEntries,
  mergeToolEntries,
} from '../components/v2/chat-tab-views-v2'
import { countSkillEntries } from '../components/v2/chat-skills-tab-v2'
import type { SourceTab } from '../components/v2/chat-header-v2'
import type { ToolDisplayMode } from '../components/message-item'
import type { ChatMessage, StreamingToolCall } from '../types'

export function useToolDisplay(params: {
  realtimeMessages: Array<ChatMessage>
  activeToolCalls: Array<StreamingToolCall>
  mcpToolNames?: ReadonlySet<string>
}) {
  const { realtimeMessages, activeToolCalls, mcpToolNames } = params

  const [activeTab, setActiveTab] = useState<SourceTab>('chat')

  // Tool-display mode: expanded | collapsed | hidden (persisted across sessions)
  const [toolDisplayMode, setToolDisplayMode] = useState<ToolDisplayMode>(
    () => {
      if (typeof window === 'undefined') return 'collapsed'
      const stored = localStorage.getItem('switchui:tool-display-mode')
      if (
        stored === 'expanded' ||
        stored === 'collapsed' ||
        stored === 'hidden'
      ) {
        return stored
      }
      return 'collapsed'
    },
  )

  const cycleToolDisplayMode = useCallback(() => {
    setToolDisplayMode((prev) => {
      const next: ToolDisplayMode =
        prev === 'expanded'
          ? 'collapsed'
          : prev === 'collapsed'
            ? 'hidden'
            : 'expanded'
      localStorage.setItem('switchui:tool-display-mode', next)
      return next
    })
  }, [])

  const toolEntries = useMemo(() => {
    const resultTsMap = buildResultTsMap(realtimeMessages)
    const streamingEntries = extractStreamingEntries(activeToolCalls)
    const completedEntries = extractStreamToolCallsFromMessages(
      realtimeMessages,
      resultTsMap,
    )
    const messageEntries = extractToolEntries(realtimeMessages)
    return mergeToolEntries(streamingEntries, completedEntries, messageEntries)
  }, [realtimeMessages, activeToolCalls])

  const totalToolCount = useMemo(
    () => filterToolEntries(toolEntries, 'all', mcpToolNames).length,
    [mcpToolNames, toolEntries],
  )
  const totalTodoCount = useMemo(
    () => filterToolEntries(toolEntries, 'todos').length,
    [toolEntries],
  )
  const totalMcpCount = useMemo(
    () => filterToolEntries(toolEntries, 'mcp', mcpToolNames).length,
    [mcpToolNames, toolEntries],
  )
  const totalFileCount = useMemo(
    () => filterToolEntries(toolEntries, 'files', mcpToolNames).length,
    [mcpToolNames, toolEntries],
  )

  const totalSkillCount = useMemo(
    () => countSkillEntries(realtimeMessages, activeToolCalls),
    [realtimeMessages, activeToolCalls],
  )

  return {
    activeTab,
    setActiveTab,
    toolDisplayMode,
    setToolDisplayMode,
    cycleToolDisplayMode,
    totalToolCount,
    totalTodoCount,
    totalMcpCount,
    totalFileCount,
    totalSkillCount,
  }
}
