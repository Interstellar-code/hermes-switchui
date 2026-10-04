import { useCallback, useMemo, useState } from 'react'

import {
  buildResultTsMap,
  extractStreamToolCallsFromMessages,
  extractStreamingEntries,
  extractToolEntries,
  filterToolEntries,
  mergeToolEntries,
} from '../components/v2/tool-entries'
import { countSkillEntries } from '../components/v2/chat-skills-tab-v2'
import type { ToolDisplayMode } from '../components/message-item'
import type { ChatMessage, StreamingToolCall } from '../types'

export function useToolDisplay(params: {
  realtimeMessages: Array<ChatMessage>
  activeToolCalls: Array<StreamingToolCall>
  mcpToolNames?: ReadonlySet<string>
}) {
  const { realtimeMessages, activeToolCalls, mcpToolNames } = params

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

  // Same rows the Tools panel lists (file-touching calls included).
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

  const totalSkillCount = useMemo(
    () => countSkillEntries(toolEntries),
    [toolEntries],
  )

  return {
    toolDisplayMode,
    setToolDisplayMode,
    cycleToolDisplayMode,
    toolEntries,
    totalToolCount,
    totalTodoCount,
    totalMcpCount,
    totalSkillCount,
  }
}
