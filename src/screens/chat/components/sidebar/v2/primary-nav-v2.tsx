'use client'

/**
 * primary-nav-v2.tsx — 232px primary navigation column for the v2 3-column layout.
 *
 * Mockup spec:
 *  - 232px wide, dark sidebar bg, right border
 *  - Top: HERMES brand glyph + name + version
 *  - Search row (⌘K hotkey hint)
 *  - New Session row
 *  - MAIN group: Dashboard, Chat, Files, Terminal, Jobs, Tasks, Conductor, Operations, Swarm
 *  - KNOWLEDGE group: Memory, Skills, MCP, Profiles
 *  - Footer: connected dot + "connected" text + cog icon
 *
 * Active state: green-tinted bg + green text + inset 2px green left border.
 * Hover: subtle fill.
 * Mono font, uppercase group labels with letter-spacing.
 *
 * Non-existent routes are rendered as non-link buttons.
 */

import { Link, useRouterState } from '@tanstack/react-router'
import { useSearchModal } from '@/hooks/use-search-modal'

// ── Nav item types ────────────────────────────────────────────────────────────

interface NavEntry {
  label: string
  icon: string // SVG path or emoji placeholder
  to?: string
  iconEl?: React.ReactNode
}

// ── Icons (inline SVG) ────────────────────────────────────────────────────────

function Icon({ d, size = 15 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <path d={d} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Icon paths
const ICONS = {
  dashboard: 'M2 2h5v5H2V2zM9 2h5v5H9V2zM2 9h5v5H2V9zM9 9h5v5H9V9z',
  chat: 'M2 3h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V4a1 1 0 0 1 1-1z',
  files: 'M3 2h6l4 4v9H3V2zM9 2v4h4',
  terminal: 'M2 3h12v10H2V3zM5 7l3-2-3-2M8 11h4',
  jobs: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 5v3.5l2.5 1.5',
  tasks: 'M3 4h10M3 8h7M3 12h5',
  conductor: 'M8 2L2 14h12L8 2zM8 8v3',
  operations: 'M3 5a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM9 5a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM1 14c0-2.5 2-4 5-4s5 1.5 5 4M11 11c1.5 0 3 .8 3 3',
  swarm: 'M5 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM11 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 5l3 4M11 5L8 9',
  memory: 'M5 3h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM6 7h4M6 9h2',
  skills: 'M8 2l1.8 3.8 4.2.6-3 3 .7 4.1L8 11.5l-3.7 2L5 9.4l-3-3 4.2-.6z',
  mcp: 'M4 8h8M8 4v8M3 3l10 10M13 3L3 13',
  profiles: 'M8 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM2 14c0-3 2.7-5 6-5s6 2 6 5',
  search: 'M6.5 1.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM10.5 10.5l4 4',
  newchat: 'M3 8h10M8 3v10',
  cog: 'M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4',
} as const

// ── Styles ────────────────────────────────────────────────────────────────────

const NAV_WIDTH = 232

function getItemStyle(active: boolean): React.CSSProperties {
  if (active) {
    return {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 10px',
      borderRadius: 4,
      background: 'color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 10%, transparent)',
      color: 'var(--m-green-400, var(--theme-accent))',
      borderLeft: '2px solid var(--m-green-500, var(--theme-accent))',
      boxShadow: 'inset 2px 0 6px color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 20%, transparent)',
      fontFamily: 'var(--font-mono, monospace)',
      fontSize: 11,
      fontWeight: 500,
      cursor: 'pointer',
      textDecoration: 'none',
      width: '100%',
      boxSizing: 'border-box',
    }
  }
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    borderRadius: 4,
    color: 'var(--theme-muted)',
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: 11,
    fontWeight: 400,
    cursor: 'pointer',
    textDecoration: 'none',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'background 0.1s, color 0.1s',
  }
}

// ── Nav item component ────────────────────────────────────────────────────────

interface NavItemProps {
  label: string
  iconKey: keyof typeof ICONS
  to?: string
  active: boolean
}

function NavItem({ label, iconKey, to, active }: NavItemProps) {
  const style = getItemStyle(active)

  if (to) {
    return (
      <Link
        to={to}
        style={style}
        className="primary-nav-v2-item"
        data-active={active ? 'true' : undefined}
      >
        <Icon d={ICONS[iconKey]} />
        {label}
      </Link>
    )
  }

  // Non-routed item — button with no navigation
  return (
    <button
      type="button"
      style={{ ...style, background: undefined }}
      className="primary-nav-v2-item"
      aria-disabled="true"
    >
      <Icon d={ICONS[iconKey]} />
      {label}
    </button>
  )
}

// ── Group label ───────────────────────────────────────────────────────────────

function GroupLabel({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: '10px 12px 4px',
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        color: 'var(--theme-muted)',
        opacity: 0.6,
        userSelect: 'none',
      }}
    >
      {label}
    </div>
  )
}

// ── Connected footer dot ──────────────────────────────────────────────────────

function ConnectedFooter({ onOpenSettings }: { onOpenSettings?: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 12px',
        borderTop: '1px solid var(--theme-border)',
        marginTop: 'auto',
      }}
    >
      {/* Status dot — always connected (gateway probe runs in workspace-shell) */}
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: 'var(--m-green-500, var(--theme-accent))',
          boxShadow: '0 0 6px var(--m-green-500, var(--theme-accent))',
          flexShrink: 0,
          display: 'inline-block',
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 10,
          color: 'var(--theme-muted)',
          flex: 1,
        }}
      >
        connected
      </span>
      <button
        type="button"
        aria-label="Settings"
        onClick={onOpenSettings}
        style={{
          background: 'none',
          border: 'none',
          padding: 4,
          borderRadius: 4,
          color: 'var(--theme-muted)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Icon d={ICONS.cog} size={13} />
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function PrimaryNavV2() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const openSearchModal = useSearchModal((s) => s.openModal)

  // Active states
  const isDashboard = pathname === '/dashboard'
  const isChat = pathname === '/' || pathname === '/new' || pathname.startsWith('/chat')
  const isFiles = pathname.startsWith('/files')
  const isTerminal = pathname.startsWith('/terminal')
  const isJobs = pathname.startsWith('/jobs')
  const isTasks = pathname.startsWith('/tasks')
  const isConductor = pathname.startsWith('/conductor')
  const isOperations = pathname.startsWith('/operations')
  const isSwarm = pathname === '/swarm' || pathname.startsWith('/swarm')
  const isMemory = pathname.startsWith('/memory')
  const isSkills = pathname.startsWith('/skills')
  const isMcp = pathname.startsWith('/mcp')
  const isProfiles = pathname.startsWith('/profiles')
  const isNewSession = pathname === '/new' || pathname.startsWith('/chat/new')

  return (
    <div
      data-testid="primary-nav-v2"
      style={{
        width: NAV_WIDTH,
        minWidth: NAV_WIDTH,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--theme-sidebar)',
        borderRight: '1px solid var(--theme-border)',
        overflow: 'hidden',
      }}
    >
      {/* Brand header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px 8px',
          borderBottom: '1px solid var(--theme-border)',
          flexShrink: 0,
        }}
      >
        <img
          src="/claude-avatar.webp"
          alt="Hermes"
          style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0 }}
        />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.05em',
              color: 'var(--theme-text)',
              lineHeight: 1.2,
            }}
          >
            HERMES
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 9,
              color: 'var(--theme-muted)',
              opacity: 0.7,
              letterSpacing: '0.1em',
            }}
          >
            v2.3.0
          </div>
        </div>
      </div>

      {/* Scrollable nav body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          padding: '6px 6px 0',
        }}
      >
        {/* Search */}
        <button
          type="button"
          onClick={openSearchModal}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            borderRadius: 4,
            width: '100%',
            background: 'none',
            border: 'none',
            color: 'var(--theme-muted)',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 11,
            cursor: 'pointer',
            boxSizing: 'border-box',
            marginBottom: 2,
          }}
          aria-label="Search (⌘K)"
        >
          <Icon d={ICONS.search} />
          <span style={{ flex: 1, textAlign: 'left' }}>Search</span>
          <span
            style={{
              fontSize: 9,
              opacity: 0.5,
              letterSpacing: '0.05em',
              fontFamily: 'var(--font-mono, monospace)',
            }}
          >
            ⌘K
          </span>
        </button>

        {/* New Session */}
        <Link
          to="/chat/$sessionKey"
          params={{ sessionKey: 'new' }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            borderRadius: 4,
            color: isNewSession
              ? 'var(--m-green-400, var(--theme-accent))'
              : 'var(--m-green-400, var(--theme-accent))',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            textDecoration: 'none',
            width: '100%',
            boxSizing: 'border-box',
            marginBottom: 4,
            opacity: 0.9,
          }}
          aria-label="New Session"
        >
          <Icon d={ICONS.newchat} />
          + New Session
        </Link>

        {/* MAIN group */}
        <GroupLabel label="Main" />
        <NavItem label="Dashboard" iconKey="dashboard" to="/dashboard" active={isDashboard} />
        <NavItem label="Chat" iconKey="chat" to="/chat" active={isChat} />
        <NavItem label="Files" iconKey="files" to="/files" active={isFiles} />
        <NavItem label="Terminal" iconKey="terminal" to="/terminal" active={isTerminal} />
        <NavItem label="Jobs" iconKey="jobs" to="/jobs" active={isJobs} />
        <NavItem label="Tasks" iconKey="tasks" to="/tasks" active={isTasks} />
        <NavItem label="Conductor" iconKey="conductor" to="/conductor" active={isConductor} />
        <NavItem label="Operations" iconKey="operations" to="/operations" active={isOperations} />
        <NavItem label="Swarm" iconKey="swarm" to="/swarm" active={isSwarm} />

        {/* KNOWLEDGE group */}
        <GroupLabel label="Knowledge" />
        <NavItem label="Memory" iconKey="memory" to="/memory" active={isMemory} />
        <NavItem label="Skills" iconKey="skills" to="/skills" active={isSkills} />
        <NavItem label="MCP" iconKey="mcp" to="/mcp" active={isMcp} />
        <NavItem label="Profiles" iconKey="profiles" to="/profiles" active={isProfiles} />
      </div>

      {/* Footer */}
      <ConnectedFooter />
    </div>
  )
}
