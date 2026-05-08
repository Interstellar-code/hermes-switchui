import { memo } from 'react'
import { ChatSourceTabsV2 } from './chat-source-tabs-v2'
import { ChatHeaderActionsV2 } from './chat-header-actions-v2'
import type { SourceTab } from './chat-source-tabs-v2'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'

type ChatHeaderV2Props = {
  activeTitle: string
  sessionKey: string
  activeTab: SourceTab
  onTabChange: (tab: SourceTab) => void
}

function ChatHeaderV2Component({
  activeTitle,
  sessionKey,
  activeTab,
  onTabChange,
}: ChatHeaderV2Props) {
  const displayTitle = activeTitle || 'New Chat'

  return (
    <div
      className="shrink-0 flex items-center gap-2 px-4 h-11"
      style={{
        background: 'var(--m-surface-1, var(--composer-bg, var(--theme-card)))',
        borderBottom: '1px solid var(--m-border, var(--composer-border, var(--theme-border)))',
      }}
    >
      {/* Left: source prefix + title */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <span
          className="shrink-0 text-[10px] font-mono font-semibold tracking-wider"
          style={{ color: 'var(--m-green, #4ade80)' }}
        >
          [CHAT]
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
        <ChatSourceTabsV2 activeTab={activeTab} onTabChange={onTabChange} />
      </div>

      {/* File explorer toggle */}
      <FileExplorerToggle />

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

function FileExplorerToggle() {
  const leftPanel = useSessionsFilterStore((s) => s.leftPanel)
  const collapsed = useSessionsFilterStore((s) => s.collapsed)
  const setLeftPanel = useSessionsFilterStore((s) => s.setLeftPanel)
  const setCollapsed = useSessionsFilterStore((s) => s.setCollapsed)
  const isFiles = leftPanel === 'files'
  return (
    <button
      type="button"
      aria-label={isFiles ? 'Show sessions' : 'Show file explorer'}
      aria-pressed={isFiles}
      title={isFiles ? 'Show sessions' : 'Show file explorer'}
      onClick={() => {
        if (collapsed) setCollapsed(false)
        setLeftPanel(isFiles ? 'sessions' : 'files')
      }}
      className="flex items-center justify-center w-7 h-7 rounded transition-colors hover:bg-[var(--m-surface-2,rgba(255,255,255,0.06))] shrink-0"
      style={{ color: isFiles ? 'var(--m-green,#4ade80)' : 'var(--m-muted,var(--theme-muted,#6b7280))' }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  )
}

export const ChatHeaderV2 = memo(ChatHeaderV2Component)
export type { SourceTab }
