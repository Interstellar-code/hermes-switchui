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
import type { SessionToolUsageEntry } from './use-session-tool-usage'
import type { ToolDisplayMode } from '../components/message-item'
import type {
  PanelCount,
  SidebarPanel,
} from '../components/v2/sidebar-panel-v2'
import type { FlatToolEntry } from '../components/v2/tool-entries'
import type { ChatMessage, StreamingToolCall } from '../types'

const NO_NAMES: ReadonlyArray<string> = []
const NO_SESSION_ENTRIES: ReadonlyArray<SessionToolUsageEntry> = []

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

/** A whole-session entry has no output text and no reliable timestamp. */
function toFlatEntry(entry: SessionToolUsageEntry): FlatToolEntry {
  return {
    key: entry.callId || `session:${entry.name}`,
    isCall: true,
    name: entry.name,
    callId: entry.callId,
    input: entry.args,
    isError: entry.isError,
  }
}

/**
 * The loaded window joined with the whole-session calls, deduped by call id.
 * The loaded entry wins: it carries the output text and the timestamps a
 * history-only call never gets. Call-id-less entries cannot be joined, so they
 * are appended as-is.
 */
function mergeWithSession(
  loaded: Array<FlatToolEntry>,
  session: ReadonlyArray<SessionToolUsageEntry>,
): Array<FlatToolEntry> {
  const byCallId = new Map<string, FlatToolEntry>()
  for (const entry of loaded) byCallId.set(entry.callId || entry.key, entry)
  for (const raw of session) {
    if (raw.callId) {
      if (byCallId.has(raw.callId)) continue
      byCallId.set(raw.callId, toFlatEntry(raw))
      continue
    }
    byCallId.set(`session:${raw.name}:${byCallId.size}`, toFlatEntry(raw))
  }
  return [...byCallId.values()]
}

export function useToolDisplay(params: {
  realtimeMessages: Array<ChatMessage>
  activeToolCalls: Array<StreamingToolCall>
  mcpToolNames?: ReadonlySet<string>
  mcpServerNames?: ReadonlyArray<string>
  /** Bare MCP tool name (lower-case) → server name. */
  mcpToolServers?: ReadonlyMap<string, string>
  /**
   * Skill + MCP calls from outside the loaded window (see
   * `useSessionToolUsage`). Only ever passed when the history is truncated.
   */
  sessionToolEntries?: ReadonlyArray<SessionToolUsageEntry>
}) {
  const {
    realtimeMessages,
    activeToolCalls,
    mcpToolNames,
    mcpServerNames = NO_NAMES,
    mcpToolServers,
    sessionToolEntries = NO_SESSION_ENTRIES,
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

  // Loaded window plus the whole-session calls. Skills and MCP read this, so a
  // skill used before the 150-message window still counts; Tools and Todos keep
  // the loaded rows only, because those panels are explicitly window-scoped.
  const mergedToolEntries = useMemo(
    () => mergeWithSession(toolEntries, sessionToolEntries),
    [sessionToolEntries, toolEntries],
  )

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
    const servers = mcpServerCount(
      mergedToolEntries,
      mcpServerNames,
      mcpToolServers,
    )
    if (servers > 0)
      counts.mcp = { value: servers, label: plural(servers, 'server') }
    const skills = distinctSkillCount(mergedToolEntries)
    if (skills > 0) counts.skills = { value: skills, label: `${skills} used` }
    return counts
  }, [
    mcpServerNames,
    mcpToolNames,
    mcpToolServers,
    mergedToolEntries,
    toolEntries,
  ])

  return {
    toolDisplayMode,
    setToolDisplayMode,
    cycleToolDisplayMode,
    toolEntries,
    /** Loaded window + whole-session calls; the Skills and MCP panels read it. */
    sessionToolEntries: mergedToolEntries,
    panelCounts,
  }
}
