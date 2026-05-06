'use client'

/**
 * sidebar-card-v2.tsx — session card for the v2 sessions list.
 *
 * Phase 3b: full mockup fidelity.
 * Layout: [rail 3px] | [body: title / src·sub / badges] | [right: time / tokens]
 */

import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { SidebarCardContextMenuV2 } from './sidebar-card-context-menu-v2'
import type { ContextMenuPosition } from './sidebar-card-context-menu-v2'
import type { SessionFeedItem } from '@/screens/chat/sessions-feed-types'

interface SidebarCardV2Props {
  item: SessionFeedItem
  isActive?: boolean
}

// ── Rail colors per source ─────────────────────────────────────────────────────

const RAIL_COLORS: Record<string, string> = {
  chat: 'var(--m-green-500, #00ff41)',
  task: '#5fcfff',
  cron: '#d6ff5f',
  tg: '#ff5fa2',
  mem: '#7dff9a',
  tool: '#b98aff',
}

const RAIL_GLOW: Record<string, string> = {
  chat: '0 0 6px var(--m-green-500, #00ff41)',
  task: '0 0 6px #5fcfff66',
  cron: '0 0 6px #d6ff5f66',
  tg: '0 0 6px #ff5fa266',
  mem: '0 0 6px #7dff9a66',
  tool: '0 0 6px #b98aff66',
}

// ── Badge colors ───────────────────────────────────────────────────────────────

function getBadgeStyle(text: string): React.CSSProperties {
  const t = text.toLowerCase()
  if (t === 'live')
    return {
      background: 'color-mix(in srgb, #00ff41 20%, transparent)',
      color: '#00ff41',
      border: '1px solid #00ff4166',
    }
  if (t === 'err' || t === 'error')
    return { background: 'color-mix(in srgb, #ff5f5f 20%, transparent)', color: '#ff5f5f', border: '1px solid #ff5f5f66' }
  if (t === 'tg' || t === 'telegram')
    return { background: 'color-mix(in srgb, #ff5fa2 20%, transparent)', color: '#ff5fa2', border: '1px solid #ff5fa266' }
  if (t === 'system')
    return { background: 'color-mix(in srgb, #5fcfff 20%, transparent)', color: '#5fcfff', border: '1px solid #5fcfff66' }
  if (t === 'done' || t === 'ok' || t === 'complete')
    return {
      background: 'color-mix(in srgb, #00ff41 15%, transparent)',
      color: '#00ff41',
      border: '1px solid #00ff4166',
    }
  return {
    background: 'var(--theme-card)',
    color: 'var(--theme-muted)',
    border: '1px solid var(--theme-border)',
  }
}

// ── Timestamp formatter ────────────────────────────────────────────────────────

function formatWhen(when: number): string {
  const now = Date.now()
  const diffMs = now - when
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffDays === 0) {
    return new Date(when).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  if (diffDays === 1) return 'Yesterday'
  const d = new Date(when)
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// ── Tokens formatter ───────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
  return String(n)
}

// ── Card ──────────────────────────────────────────────────────────────────────

export function SidebarCardV2({ item, isActive }: SidebarCardV2Props) {
  const railColor = RAIL_COLORS[item.src] ?? 'var(--theme-border)'
  // Glow: always emit when item.live is true regardless of isActive; active also glows
  const railGlow =
    item.live || isActive ? (RAIL_GLOW[item.src] ?? 'none') : 'none'

  // Determine link target per source.
  // `tool` and `tg` have no detail route — left non-clickable intentionally.
  // TODO: wire `tg` when a Telegram session detail route is added.
  // TODO: wire `tool` when a tool-run detail route is added.
  const rawId = item.id.split(':').slice(1).join(':')
  const isChatItem = item.src === 'chat'
  const isCronItem = item.src === 'cron'
  const isTaskItem = item.src === 'task'
  const isMemItem = item.src === 'mem'
  const isClickable = isChatItem || isCronItem || isTaskItem || isMemItem

  const [hovered, setHovered] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<ContextMenuPosition | null>(null)

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  const cardContent = (
    <div
      className="w-full flex items-stretch text-left transition-all"
      data-testid={`session-card-${item.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={handleContextMenu}
      style={{
        background: isActive
          ? 'color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 8%, var(--theme-card))'
          : 'transparent',
        borderBottom: '1px solid var(--theme-border-subtle, var(--theme-border))',
        borderLeft: isActive ? `2px solid ${railColor}` : '2px solid transparent',
        boxShadow: isActive ? `inset 2px 0 8px ${railColor}44` : 'none',
        cursor: isClickable ? 'pointer' : 'default',
        minHeight: 56,
        position: 'relative',
      }}
    >
      {/* Left rail — 3px color strip */}
      <div
        aria-hidden
        data-testid={`card-rail-${item.src}`}
        style={{
          width: 3,
          background: railColor,
          flexShrink: 0,
          boxShadow: railGlow,
        }}
      />

      {/* Body */}
      <div className="flex flex-col justify-center gap-0.5 px-2 py-2 min-w-0 flex-1">
        {/* Title line */}
        <div className="flex items-center gap-1 min-w-0">
          {item.pinned && (
            <span style={{ color: 'var(--m-green-400, var(--theme-accent))', fontSize: 10, flexShrink: 0 }}>★</span>
          )}
          <span
            className="text-xs font-medium truncate"
            style={{ color: 'var(--theme-text)' }}
          >
            {item.title}
          </span>
        </div>

        {/* Meta row: src · sub */}
        <span
          className="text-xs truncate"
          style={{
            color: 'var(--theme-muted)',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 9,
          }}
        >
          <span style={{ opacity: 0.7 }}>{item.src}</span>
          {item.sub ? (
            <>
              <span style={{ opacity: 0.4 }}> · </span>
              <span style={{ opacity: 0.6 }}>{item.sub}</span>
            </>
          ) : null}
        </span>

        {/* Badges row */}
        {item.badges.length > 0 && (
          <div className="flex flex-wrap gap-0.5 mt-0.5">
            {item.live && (
              <Badge text="live" badgeStyle={getBadgeStyle('live')} pulse />
            )}
            {item.badges.map((badge, i) => (
              <Badge key={i} text={badge.text} badgeStyle={badge.color ? {
                background: `color-mix(in srgb, ${badge.color} 20%, transparent)`,
                color: badge.color,
                border: `1px solid ${badge.color}66`,
              } : getBadgeStyle(badge.text)} />
            ))}
          </div>
        )}
        {/* Live badge even without other badges */}
        {item.live && item.badges.length === 0 && (
          <div className="flex flex-wrap gap-0.5 mt-0.5">
            <Badge text="live" badgeStyle={getBadgeStyle('live')} pulse />
          </div>
        )}
      </div>

      {/* Right column: time + tokens + three-dot menu trigger */}
      <div
        className="flex flex-col items-end justify-center gap-0.5 px-2 py-2 shrink-0"
        style={{ minWidth: 52 }}
      >
        {hovered ? (
          <button
            type="button"
            aria-label="Session actions"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
              setCtxMenu({ x: rect.left, y: rect.bottom + 4 })
            }}
            style={{
              background: 'transparent',
              border: '1px solid var(--theme-border)',
              borderRadius: 3,
              cursor: 'pointer',
              color: 'var(--theme-muted)',
              fontSize: 12,
              lineHeight: 1,
              width: 20,
              height: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            ⋯
          </button>
        ) : (
          <span
            className="text-xs"
            style={{
              color: 'var(--theme-muted)',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 9,
              whiteSpace: 'nowrap',
            }}
          >
            {formatWhen(item.when)}
          </span>
        )}
        {item.tokens != null && (
          <span
            style={{
              color: 'var(--theme-muted)',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 9,
              opacity: 0.6,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            {formatTokens(item.tokens)}
          </span>
        )}
      </div>
    </div>
  )

  const contextMenuEl = ctxMenu ? (
    <SidebarCardContextMenuV2
      item={item}
      position={ctxMenu}
      onClose={() => setCtxMenu(null)}
    />
  ) : null

  if (isChatItem) {
    return (
      <>
        <Link
          to="/chat/$sessionKey"
          params={{ sessionKey: rawId }}
          preload="intent"
          style={{ display: 'block', textDecoration: 'none' }}
        >
          {cardContent}
        </Link>
        {contextMenuEl}
      </>
    )
  }

  if (isCronItem) {
    // /jobs is a flat list — no $jobId detail route exists yet.
    return (
      <>
        <Link to="/jobs" preload="intent" style={{ display: 'block', textDecoration: 'none' }}>
          {cardContent}
        </Link>
        {contextMenuEl}
      </>
    )
  }

  if (isTaskItem) {
    // /tasks is a flat kanban board — no $taskId detail route exists yet.
    return (
      <>
        <Link to="/tasks" preload="intent" style={{ display: 'block', textDecoration: 'none' }}>
          {cardContent}
        </Link>
        {contextMenuEl}
      </>
    )
  }

  if (isMemItem) {
    // /memory is a flat browser — no $path detail route exists yet.
    return (
      <>
        <Link to="/memory" preload="intent" style={{ display: 'block', textDecoration: 'none' }}>
          {cardContent}
        </Link>
        {contextMenuEl}
      </>
    )
  }

  return <>{cardContent}{contextMenuEl}</>
}

// ── Badge ─────────────────────────────────────────────────────────────────────

interface BadgeProps {
  text: string
  badgeStyle: React.CSSProperties
  pulse?: boolean
}

function Badge({ text, badgeStyle, pulse }: BadgeProps) {
  return (
    <span
      className="flex items-center gap-0.5 rounded-full px-1.5"
      style={{
        ...badgeStyle,
        fontSize: 8,
        lineHeight: '14px',
        fontFamily: 'var(--font-mono, monospace)',
        letterSpacing: '0.04em',
        textTransform: 'lowercase',
      }}
    >
      {pulse && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: 'currentColor',
            display: 'inline-block',
            flexShrink: 0,
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
      )}
      {text}
    </span>
  )
}
