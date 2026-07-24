import { memo } from 'react'
import { ChatSourceTabsV2 } from './chat-source-tabs-v2'
import { ChatHeaderActionsV2 } from './chat-header-actions-v2'
import type { SourceTab } from './chat-source-tabs-v2'
import type { SessionSource } from '@/screens/chat/sessions-feed-types'
import { useSessionStatus } from '@/hooks/use-session-status'
import { formatCostUsd } from '@/lib/format'
import { SOURCE_COLORS, SOURCE_LABELS } from '@/screens/chat/source-visuals'

type ChatHeaderV2Props = {
  activeTitle: string
  sessionKey: string
  activeTab: SourceTab
  onTabChange: (tab: SourceTab) => void
  tabCounts?: Partial<Record<SourceTab, number>>
  sourceKind?: SessionSource
  fileExplorerCollapsed: boolean
  onToggleFileExplorer: () => void
}

function ChatHeaderV2Component({
  activeTitle,
  sessionKey,
  activeTab,
  onTabChange,
  tabCounts,
  sourceKind = 'chat',
  fileExplorerCollapsed,
  onToggleFileExplorer,
}: ChatHeaderV2Props) {
  const displayTitle = activeTitle || 'New Chat'
  const accent = SOURCE_COLORS[sourceKind]
  const sourceLabel = SOURCE_LABELS[sourceKind]

  return (
    <div
      className="shrink-0 flex items-center gap-2 px-4 h-11"
      style={{
        background: `color-mix(in srgb, ${accent} 10%, var(--m-surface-1, var(--composer-bg, var(--theme-card))))`,
        borderBottom: `1px solid color-mix(in srgb, ${accent} 40%, var(--m-border, var(--composer-border, var(--theme-border))))`,
        boxShadow: `0 1px 8px color-mix(in srgb, ${accent} 12%, transparent)`,
      }}
    >
      {/* Left: source prefix + title */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <span
          className="m-chip flex items-center rounded-full px-2 py-0.5 shrink-0"
          style={{
            background: `color-mix(in srgb, ${accent} 18%, transparent)`,
            color: accent,
            border: `1px solid ${accent}`,
            boxShadow: `0 0 6px color-mix(in srgb, ${accent} 40%, transparent)`,
          }}
        >
          {sourceLabel}
        </span>
        <span
          className="truncate text-sm font-medium"
          style={{ color: 'var(--m-text, var(--theme-text))' }}
          title={displayTitle}
        >
          {displayTitle}
        </span>
      </div>

      {/* Center: source tabs */}
      <div className="shrink-0">
        <ChatSourceTabsV2
          activeTab={activeTab}
          onTabChange={onTabChange}
          counts={tabCounts}
        />
      </div>

      {/* File explorer toggle */}
      <FileExplorerToggle
        collapsed={fileExplorerCollapsed}
        onToggle={onToggleFileExplorer}
      />

      {/* Session cost pill */}
      <SessionCostPill sessionKey={sessionKey} />

      {/* Right: actions */}
      <div className="shrink-0">
        <ChatHeaderActionsV2
          sessionId={`chat:${sessionKey}`}
          sessionKey={sessionKey}
          title={displayTitle}
        />
      </div>
    </div>
  )
}

function FileExplorerToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-label={collapsed ? 'Show file explorer' : 'Hide file explorer'}
      aria-pressed={!collapsed}
      title={collapsed ? 'Show file explorer' : 'Hide file explorer'}
      onClick={onToggle}
      className="flex items-center justify-center w-7 h-7 rounded transition-colors hover:bg-[var(--m-surface-2,rgba(255,255,255,0.06))] shrink-0"
      style={{ color: !collapsed ? 'var(--m-green,#4ade80)' : 'var(--m-muted,var(--theme-muted,#6b7280))' }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  )
}

function SessionCostPill({ sessionKey }: { sessionKey: string }) {
  const status = useSessionStatus(sessionKey)
  if (!status.cost || status.cost <= 0) return null
  return (
    <span
      data-testid="header-cost"
      title="Session cost"
      className="flex items-center h-7 px-2 rounded text-[11px] font-mono shrink-0"
      style={{ color: 'var(--m-muted,var(--theme-muted,#6b7280))' }}
    >
      {formatCostUsd(status.cost)}
    </span>
  )
}

export const ChatHeaderV2 = memo(ChatHeaderV2Component)
export type { SourceTab }
