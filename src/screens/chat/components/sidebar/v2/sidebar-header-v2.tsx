'use client'

/**
 * sidebar-header-v2.tsx — header row for the sessions panel.
 *
 * Shows: "Sessions" title, session count, refresh / date-filter / collapse icons.
 * Phase 3a: placeholder — count + actions wired in 3b.
 */

interface SidebarHeaderV2Props {
  onCollapse?: () => void
}

export function SidebarHeaderV2({ onCollapse }: SidebarHeaderV2Props) {
  return (
    <div
      className="flex items-center justify-between shrink-0 px-3"
      data-testid="sessions-panel-header"
      style={{
        height: 44,
        borderBottom: '1px solid var(--theme-border)',
        background: 'var(--theme-sidebar)',
      }}
    >
      <span
        className="text-xs font-semibold uppercase tracking-widest select-none"
        style={{ color: 'var(--theme-muted)' }}
      >
        Sessions
      </span>

      <div className="flex items-center gap-1">
        {/* Collapse button */}
        <button
          type="button"
          aria-label="Collapse sessions panel"
          onClick={onCollapse}
          className="flex items-center justify-center rounded"
          style={{
            width: 24,
            height: 24,
            color: 'var(--theme-muted)',
            background: 'transparent',
          }}
        >
          ‹
        </button>
      </div>
    </div>
  )
}
