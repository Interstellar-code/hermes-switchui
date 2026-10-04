import { useCallback, useMemo, useState } from 'react'

import {
  buildResultTsMap,
  extractStreamToolCallsFromMessages,
  extractStreamingEntries,
  extractToolEntries,
  filterToolEntries,
  mergeToolEntries,
} from '../components/v2/tool-entries'
import { todoProgress } from '../components/v2/todos-panel-v2'
import { mcpServerCount } from '../components/v2/mcp-panel-v2'
import { distinctSkillCount } from '../components/v2/skills-panel-v2'
import type { ToolDisplayMode } from '../components/message-item'
import type {
  PanelCount,
  SidebarPanel,
} from '../components/v2/sidebar-panel-v2'
import type { ChatMessage, StreamingToolCall } from '../types'

const NO_NAMES: ReadonlyArray<string> = []

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

export function useToolDisplay(params: {
  realtimeMessages: Array<ChatMessage>
  activeToolCalls: Array<StreamingToolCall>
  mcpToolNames?: ReadonlySet<string>
  mcpServerNames?: ReadonlyArray<string>
  /** Bare MCP tool name (lower-case) → server name. */
  mcpToolServers?: ReadonlyMap<string, string>
}) {
  const {
    realtimeMessages,
    activeToolCalls,
    mcpToolNames,
    mcpServerNames = NO_NAMES,
    mcpToolServers,
  } = params

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

  // Header + panel-title counts. Tools = the rows the Tools panel lists
  // (file-touching calls included) plus their errors.
  const panelCounts = useMemo(() => {
    const counts: Partial<Record<SidebarPanel, PanelCount>> = {}
    const rows = filterToolEntries(toolEntries, 'all', mcpToolNames)
    const errors = rows.filter((e) => e.isError).length
    if (rows.length > 0) {
      counts.tool = {
        value: rows.length,
        label: `${plural(rows.length, 'call')}${errors ? `, ${plural(errors, 'error')}` : ''}`,
        errors,
      }
    }
    const todos = todoProgress(toolEntries)
    if (todos && todos.total > 0) {
      counts.todos = {
        value: `${todos.done}/${todos.total}`,
        label: `${todos.done} of ${todos.total} done`,
      }
    }
    const servers = mcpServerCount(toolEntries, mcpServerNames, mcpToolServers)
    if (servers > 0)
      counts.mcp = { value: servers, label: plural(servers, 'server') }
    const skills = distinctSkillCount(toolEntries)
    if (skills > 0) counts.skills = { value: skills, label: `${skills} used` }
    return counts
  }, [mcpServerNames, mcpToolNames, mcpToolServers, toolEntries])

  return {
    toolDisplayMode,
    setToolDisplayMode,
    cycleToolDisplayMode,
    toolEntries,
    panelCounts,
  }
}
