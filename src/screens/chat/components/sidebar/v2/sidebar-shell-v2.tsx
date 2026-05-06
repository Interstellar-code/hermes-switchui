'use client'

/**
 * sidebar-shell-v2.tsx — 3-column grid shell for the unified sessions sidebar.
 *
 * Layout (desktop):
 *   col 1: 44px collapsed rail  (always visible)
 *   col 2: 232px sources panel  (hidden when collapsed)
 *   col 3: 1fr chat column      (passes children through)
 *
 * Phase 3a: structure + collapse logic only.
 * Full UI fidelity implemented in Phase 3b/3c.
 */

import { useState } from 'react'
import { SidebarRailV2 } from './sidebar-rail-v2'
import { SidebarHeaderV2 } from './sidebar-header-v2'
import { SidebarSearchV2 } from './sidebar-search-v2'
import { SidebarSourceChipsV2 } from './sidebar-source-chips-v2'
import { SidebarStateSegmentV2 } from './sidebar-state-segment-v2'
import { SidebarListV2 } from './sidebar-list-v2'

interface SidebarShellV2Props {
  /** The main chat column content (route outlet). */
  children?: React.ReactNode
}

export function SidebarShellV2({ children }: SidebarShellV2Props) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div
      className="flex h-full overflow-hidden"
      data-testid="sidebar-shell-v2"
      style={{ background: 'var(--theme-sidebar)' }}
    >
      {/* Rail — always 44px */}
      <SidebarRailV2
        collapsed={collapsed}
        onExpand={() => setCollapsed(false)}
      />

      {/* Sessions panel — 320px, hidden when collapsed */}
      {!collapsed && (
        <div
          className="flex flex-col border-r shrink-0 overflow-hidden"
          data-testid="sessions-panel"
          style={{
            width: 320,
            borderColor: 'var(--theme-border)',
            background: 'var(--theme-sidebar)',
          }}
        >
          <SidebarHeaderV2 onCollapse={() => setCollapsed(true)} />
          <SidebarSearchV2 />
          <SidebarSourceChipsV2 />
          <SidebarStateSegmentV2 />
          <SidebarListV2 />
        </div>
      )}

      {/* Main content (1fr) */}
      <div className="flex-1 min-w-0 overflow-hidden">{children}</div>
    </div>
  )
}
