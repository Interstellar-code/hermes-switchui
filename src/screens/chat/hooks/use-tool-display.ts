import { useCallback, useMemo, useState } from 'react'

import {
  buildResultTsMap,
  extractStreamToolCallsFromMessages,
  extractStreamingEntries,
  extractToolEntries,
  mergeToolEntries,
} from '../components/v2/chat-tab-views-v2'
import { countSkillEntries } from '../components/v2/chat-skills-tab-v2'
import type { SourceTab } from '../components/v2/chat-header-v2'
import type { ToolDisplayMode } from '../components/message-item'
import type { ChatMessage, StreamingToolCall } from '../types'

export function useToolDisplay(params: {
  realtimeMessages: Array<ChatMessage>
  activeToolCalls: Array<StreamingToolCall>
}) {
  const { realtimeMessages, activeToolCalls } = params

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

  const totalToolCount = useMemo(() => {
    const resultTsMap = buildResultTsMap(realtimeMessages)
    const streamingEntries = extractStreamingEntries(activeToolCalls)
    const completedEntries = extractStreamToolCallsFromMessages(
      realtimeMessages,
      resultTsMap,
    )
    const messageEntries = extractToolEntries(realtimeMessages)
    return mergeToolEntries(streamingEntries, completedEntries, messageEntries)
      .length
  }, [realtimeMessages, activeToolCalls])

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
    totalSkillCount,
  }
}
