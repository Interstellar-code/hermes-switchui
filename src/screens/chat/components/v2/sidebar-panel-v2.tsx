import { useId } from 'react'
import { ToolPanelV2 } from './tool-panel-v2'
import { TodosPanelV2 } from './todos-panel-v2'
import { McpPanelV2 } from './mcp-panel-v2'
import { SkillsPanelV2 } from './skills-panel-v2'
import { DelegationPanelV2 } from './delegation-tab-view'
import type { McpPanelServer } from './mcp-panel-v2'
import type { FlatToolEntry } from './tool-entries'

export type SidebarPanel =
  | 'files'
  | 'tool'
  | 'todos'
  | 'mcp'
  | 'skills'
  | 'agents'
/** Panels rendered by this frame; `files` stays the FileExplorerSidebar. */
export type ContentPanel = Exclude<SidebarPanel, 'files'>

/** A panel's count as shown in the header toggle and the panel title. */
export type PanelCount = {
  /** Badge text; hidden when 0 or ''. */
  value: string | number
  /** Accessible text appended to the panel name, e.g. "66 calls, 4 errors". */
  label: string
  /** Shown as a small red number after the value. */
  errors?: number
  /** Animate the toggle while the panel has live work and is not open. */
  pulse?: boolean
}

type LifecycleEvent = {
  text: string
  emoji: string
  timestamp: number
  isError: boolean
}

export type SidebarPanelV2Props = {
  panel: ContentPanel
  sessionKey: string
  entries: Array<FlatToolEntry>
  events?: Array<LifecycleEvent>
  mcpToolNames?: ReadonlySet<string>
  mcpServers?: ReadonlyArray<McpPanelServer>
  /** Bare MCP tool name (lower-case) → server name. */
  mcpToolServers?: ReadonlyMap<string, string>
  historyCapped?: boolean
  /**
   * Loaded window + whole-session skill/MCP calls. Read by the Skills and MCP
   * panels only; the Tools and Todos panels stay on the loaded `entries`.
   */
  sessionToolEntries?: Array<FlatToolEntry>
  counts?: Partial<Record<SidebarPanel, PanelCount>>
  onClose: () => void
}

export const PANEL_TITLES: Record<ContentPanel, string> = {
  tool: 'Tools',
  todos: 'Todos',
  mcp: 'MCP',
  skills: 'Skills',
  agents: 'Agents',
}

export function SidebarPanelV2({
  panel,
  sessionKey,
  entries,
  events,
  mcpToolNames,
  mcpServers,
  mcpToolServers,
  historyCapped,
  sessionToolEntries,
  counts,
  onClose,
}: SidebarPanelV2Props) {
  const titleId = useId()
  const count = counts?.[panel]

  return (
    <div
      id="chat-sidebar-panel"
      role="region"
      aria-labelledby={titleId}
      data-testid="sidebar-panel-v2"
      className="flex h-full w-full min-w-0 flex-col overflow-hidden"
      style={{ background: 'var(--theme-sidebar)', color: 'var(--theme-text)' }}
    >
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <button
          type="button"
          aria-label="Back to sessions"
          onClick={onClose}
          className="shrink-0 rounded border px-1.5 py-0.5 text-[13px] leading-none"
          style={{
            borderColor: 'var(--theme-border)',
            color: 'var(--theme-muted)',
            background: 'transparent',
          }}
        >
          ←
        </button>
        <h2
          id={titleId}
          className="m-mono min-w-0 truncate text-xs font-extrabold uppercase tracking-[0.16em]"
          style={{ color: 'var(--theme-accent)' }}
        >
          {PANEL_TITLES[panel]}
        </h2>
        {count && count.label ? (
          <span
            data-testid="sidebar-panel-count"
            className="min-w-0 truncate text-[10px] tabular-nums"
            style={{ color: 'var(--theme-muted)' }}
          >
            {count.label}
          </span>
        ) : null}
      </div>
      {/* Keyed so filters/search reset when the panel or session changes. */}
      <div
        key={`${panel}:${sessionKey}`}
        data-testid="sidebar-panel-body"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden"
      >
        {panel === 'tool' ? (
          <ToolPanelV2
            entries={entries}
            events={events}
            mcpToolNames={mcpToolNames}
            historyCapped={historyCapped}
          />
        ) : panel === 'todos' ? (
          <TodosPanelV2 entries={entries} />
        ) : panel === 'mcp' ? (
          <McpPanelV2
            entries={sessionToolEntries ?? entries}
            servers={mcpServers}
            toolServers={mcpToolServers}
          />
        ) : panel === 'agents' ? (
          <DelegationPanelV2 sessionKey={sessionKey} />
        ) : (
          <SkillsPanelV2 entries={sessionToolEntries ?? entries} />
        )}
      </div>
    </div>
  )
}
