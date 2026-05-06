'use client'

/**
 * sidebar-card-v2.tsx — session card for the v2 sessions list.
 *
 * Renders a color-coded left rail + title + meta line.
 * Phase 3a: basic card structure; badges + actions in 3b.
 */

import type { SessionFeedItem } from '@/screens/chat/sessions-feed-types'

interface SidebarCardV2Props {
  item: SessionFeedItem
  isActive?: boolean
  onClick?: () => void
}

/** Rail colors per source — matches mockup palette. */
const RAIL_COLORS: Record<string, string> = {
  chat: '#00ff41',
  task: '#5fcfff',
  cron: '#d6ff5f',
  mem: '#ff5fa2',
  tool: '#b98aff',
  tg: '#ff9f5f',
}

export function SidebarCardV2({ item, isActive, onClick }: SidebarCardV2Props) {
  const railColor = (RAIL_COLORS as Record<string, string | undefined>)[item.source] ?? 'var(--theme-border)'

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-stretch text-left transition-colors"
      style={{
        background: isActive ? 'var(--theme-card2, var(--theme-card))' : 'transparent',
        borderBottom: '1px solid var(--theme-border-subtle, var(--theme-border))',
      }}
    >
      {/* Color rail */}
      <div
        aria-hidden
        style={{ width: 3, background: railColor, flexShrink: 0 }}
      />

      {/* Content */}
      <div className="flex flex-col gap-0.5 px-2 py-2 min-w-0 flex-1">
        <span
          className="text-xs font-medium truncate"
          style={{ color: 'var(--theme-text)' }}
        >
          {item.title}
        </span>
        <span
          className="text-xs truncate"
          style={{ color: 'var(--theme-muted)' }}
        >
          {item.source}
          {item.subtitle ? ` · ${item.subtitle}` : ''}
        </span>
      </div>
    </button>
  )
}
