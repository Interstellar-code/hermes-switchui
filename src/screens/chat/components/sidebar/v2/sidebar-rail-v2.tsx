'use client'

/**
 * sidebar-rail-v2.tsx — collapsed 44px rail for the v2 sidebar.
 *
 * Shown at all times. In expanded mode it's just the 44px icon strip.
 * Phase 3a: expand button only; source icons + live-count badge in 3b.
 */

interface SidebarRailV2Props {
  collapsed: boolean
  onExpand: () => void
}

export function SidebarRailV2({ collapsed, onExpand }: SidebarRailV2Props) {
  return (
    <div
      className="flex flex-col items-center shrink-0"
      data-testid="sidebar-rail-v2"
      aria-label={collapsed ? 'Expand sessions panel' : 'Sessions rail'}
      style={{
        width: 44,
        borderRight: '1px solid var(--theme-border)',
        background: 'var(--theme-sidebar)',
      }}
    >
      {/* Expand button — only useful when collapsed */}
      {collapsed && (
        <button
          type="button"
          aria-label="Expand sessions panel"
          onClick={onExpand}
          className="mt-2 flex items-center justify-center rounded"
          style={{
            width: 28,
            height: 28,
            color: 'var(--theme-muted)',
            background: 'transparent',
          }}
        >
          ›
        </button>
      )}
    </div>
  )
}
