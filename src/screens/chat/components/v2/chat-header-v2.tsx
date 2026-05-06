import { memo } from 'react'
import { ChatSourceTabsV2 } from './chat-source-tabs-v2'
import { ChatHeaderActionsV2 } from './chat-header-actions-v2'
import type { SourceTab } from './chat-source-tabs-v2'

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

export const ChatHeaderV2 = memo(ChatHeaderV2Component)
export type { SourceTab }
