import { useEffect, useId, useRef } from 'react'
import { ChatSkillsTabV2 } from './chat-skills-tab-v2'
import { ToolTabView } from './chat-tab-views-v2'
import type { RefObject } from 'react'
import type { FlatToolEntry } from './tool-entries'

export type SidebarPanel = 'files' | 'tool' | 'todos' | 'mcp' | 'skills'
/** Panels rendered by this frame; `files` stays the FileExplorerSidebar. */
export type ContentPanel = Exclude<SidebarPanel, 'files'>

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
  counts?: Partial<Record<SidebarPanel, number>>
  onClose: () => void
  variant?: 'sidebar' | 'sheet'
  /** Sheet only: element to focus on close. Defaults to whatever had focus on open. */
  returnFocusRef?: RefObject<HTMLElement | null>
}

export const PANEL_TITLES: Record<ContentPanel, string> = {
  tool: 'Tools',
  todos: 'Todos',
  mcp: 'MCP',
  skills: 'Skills',
}

export function SidebarPanelV2({
  panel,
  sessionKey,
  entries,
  events,
  mcpToolNames,
  counts,
  onClose,
  variant = 'sidebar',
  returnFocusRef,
}: SidebarPanelV2Props) {
  const titleId = useId()
  const backRef = useRef<HTMLButtonElement>(null)
  const isSheet = variant === 'sheet'
  const count = counts?.[panel]

  useEffect(() => {
    if (!isSheet) return
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    backRef.current?.focus()
    return () => {
      ;(returnFocusRef?.current ?? opener)?.focus()
    }
  }, [isSheet, returnFocusRef])

  return (
    <div
      id="chat-sidebar-panel"
      role={isSheet ? 'dialog' : 'region'}
      aria-modal={isSheet ? true : undefined}
      aria-labelledby={titleId}
      data-testid="sidebar-panel-v2"
      className={
        isSheet
          ? 'fixed inset-0 z-40 flex min-w-0 flex-col overflow-hidden'
          : 'flex h-full w-full min-w-0 flex-col overflow-hidden'
      }
      style={{
        background: isSheet ? 'var(--theme-bg)' : 'var(--theme-sidebar)',
        color: 'var(--theme-text)',
      }}
    >
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <button
          ref={backRef}
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
        {count !== undefined ? (
          <span
            data-testid="sidebar-panel-count"
            className="shrink-0 text-[10px] tabular-nums"
            style={{ color: 'var(--theme-muted)' }}
          >
            {count}
          </span>
        ) : null}
      </div>
      {/* Keyed so filters/search reset when the panel or session changes. */}
      <div
        key={`${panel}:${sessionKey}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {panel === 'skills' ? (
          <ChatSkillsTabV2 entries={entries} />
        ) : (
          <ToolTabView
            entries={entries}
            view={panel === 'tool' ? 'all' : panel}
            events={panel === 'tool' ? events : undefined}
            mcpToolNames={mcpToolNames}
          />
        )}
      </div>
    </div>
  )
}
