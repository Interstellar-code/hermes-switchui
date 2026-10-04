import type { ReactNode } from 'react'
import type { PanelCount, SidebarPanel } from './sidebar-panel-v2'
import { cn } from '@/lib/utils'

export type { PanelCount, SidebarPanel }

type TabDef = {
  id: SidebarPanel
  label: string
  /** Accessible name; the count's label is appended, e.g. "Tools, 12 calls". */
  aria: string
  icon: ReactNode
}

const TABS: Array<TabDef> = [
  {
    id: 'files',
    label: 'files',
    aria: 'Files',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M4 3h7l2 3h7v15H4z" />
        <path d="M4 8h16" />
      </svg>
    ),
  },
  {
    id: 'tool',
    label: 'tool',
    aria: 'Tools',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
  },
  {
    id: 'todos',
    label: 'todos',
    aria: 'Todos',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    id: 'mcp',
    label: 'mcp',
    aria: 'MCP',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 2v7" />
        <path d="M8 5l4 4 4-4" />
        <path d="M5 12a3 3 0 0 0 0 6h2v-6H5zM19 12a3 3 0 0 1 0 6h-2v-6h2z" />
        <path d="M7 15h10" />
      </svg>
    ),
  },
  {
    id: 'skills',
    label: 'skills',
    aria: 'Skills',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
]

type ChatSourceTabsV2Props = {
  /** The panel currently shown in the sidebar, or null for the sessions list. */
  activePanel: SidebarPanel | null
  onTogglePanel: (panel: SidebarPanel) => void
  /** Per-panel counts. Badge shown when the value is non-zero/non-empty. */
  counts?: Partial<Record<SidebarPanel, PanelCount>>
  /** Omit the files toggle (no sidebar for the explorer, e.g. mobile). */
  hideFiles?: boolean
}

export function ChatSourceTabsV2({ activePanel, onTogglePanel, counts, hideFiles }: ChatSourceTabsV2Props) {
  return (
    <div
      role="group"
      aria-label="Sidebar panels"
      className="flex items-center gap-0.5 rounded-md p-0.5"
      style={{
        background: 'var(--m-surface-2, var(--theme-card2, rgba(0,0,0,0.15)))',
        border: '1px solid var(--m-border, var(--theme-border, rgba(255,255,255,0.08)))',
      }}
    >
      {TABS.filter((tab) => !(hideFiles && tab.id === 'files')).map((tab) => {
        const isActive = tab.id === activePanel
        const count = counts?.[tab.id]
        const shown = count && count.value !== 0 && count.value !== '' ? count : null
        const name = shown ? `${tab.aria}, ${shown.label}` : tab.aria
        return (
          <button
            key={tab.id}
            type="button"
            aria-pressed={isActive}
            aria-controls={isActive ? 'chat-sidebar-panel' : undefined}
            data-panel={tab.id}
            aria-label={name}
            title={name}
            onClick={() => onTogglePanel(tab.id)}
            className={cn(
              'flex items-center gap-1 h-7 min-w-7 justify-center px-1.5 rounded text-[11px] font-mono font-medium transition-all duration-150 select-none',
              isActive
                ? 'text-[var(--m-green,#4ade80)]'
                : 'text-[var(--m-muted,var(--theme-muted,#6b7280))] hover:text-[var(--m-text,var(--theme-text))]',
            )}
            style={
              isActive
                ? {
                    background: 'var(--m-green-10, rgba(74,222,128,0.10))',
                    border: '1px solid var(--m-green-30, rgba(74,222,128,0.30))',
                    boxShadow: 'inset 0 1px 3px rgba(74,222,128,0.10)',
                  }
                : {
                    background: 'transparent',
                    border: '1px solid transparent',
                  }
            }
          >
            {tab.icon}
            {shown && (
              <span
                data-testid={`tab-count-${tab.id}`}
                className="tabular-nums opacity-70"
              >
                {shown.value}
              </span>
            )}
            {shown?.errors ? (
              <span
                data-testid={`tab-errors-${tab.id}`}
                className="tabular-nums text-[9px]"
                style={{ color: 'var(--theme-danger, #ef4444)' }}
              >
                {shown.errors}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
