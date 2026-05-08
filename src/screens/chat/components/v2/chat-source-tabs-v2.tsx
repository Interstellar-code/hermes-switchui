import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type SourceTab = 'chat' | 'tool' | 'skills'

type TabDef = {
  id: SourceTab
  label: string
  icon: ReactNode
}

const TABS: Array<TabDef> = [
  {
    id: 'chat',
    label: 'chat',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: 'tool',
    label: 'tool',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
  },
  {
    id: 'skills',
    label: 'skills',
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
  activeTab: SourceTab
  onTabChange: (tab: SourceTab) => void
}

export function ChatSourceTabsV2({ activeTab, onTabChange }: ChatSourceTabsV2Props) {
  return (
    <div
      role="tablist"
      aria-label="Chat view tabs"
      className="flex items-center gap-0.5 rounded-md p-0.5"
      style={{
        background: 'var(--m-surface-2, var(--theme-card2, rgba(0,0,0,0.15)))',
        border: '1px solid var(--m-border, var(--theme-border, rgba(255,255,255,0.08)))',
      }}
    >
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono font-medium transition-all duration-150 select-none',
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
            <span className={isActive ? 'text-[var(--m-green,#4ade80)]' : ''}>
              {tab.icon}
            </span>
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
