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
  cron: '#d6ff5f',
  api: '#5fcfff',
  tg: '#ff5fa2',
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
  // chat / cron / api are all backed by chat sessions — only the key prefix
  // differs. All three navigate via /chat/$sessionKey.
  const isChatItem = item.src === 'chat' || item.src === 'cron' || item.src === 'api'
  // cron/task/mem: no chat_session_key available from the gateway — these
  // sources carry no field that maps to a /chat/$sessionKey route. Clicking
  // navigates to the global list pages which is disorienting inside the chat
  // layout. Kept non-clickable until the backend exposes a session mapping.
  // Unblocked by: ClaudeJob.session_key | HermesKanbanTask.chat_session_key
  const isClickable = isChatItem

  const [hovered, setHovered] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<ContextMenuPosition | null>(null)

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  const cardContent = (
    <div
      className="flex items-stretch text-left transition-all group/card"
      data-testid={`session-card-${item.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={handleContextMenu}
      style={{
        margin: '4px 8px',
        borderRadius: 6,
        background: isActive
          ? `color-mix(in srgb, ${railColor} 22%, var(--theme-card))`
          : hovered
            ? 'color-mix(in srgb, var(--theme-card) 70%, transparent)'
            : 'color-mix(in srgb, var(--theme-card) 30%, transparent)',
        border: isActive
          ? `1.5px solid ${railColor}`
          : '1px solid var(--theme-border-subtle, var(--theme-border))',
        boxShadow: isActive
          ? `inset 0 0 0 1px ${railColor}77, 0 0 18px ${railColor}88, 0 0 6px ${railColor}55`
          : hovered
            ? `0 0 0 1px ${railColor}33`
            : 'none',
        cursor: isClickable ? 'pointer' : 'default',
        minHeight: 60,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Left rail — 3px color strip with glow on active/hover/live */}
      <div
        aria-hidden
        data-testid={`card-rail-${item.src}`}
        style={{
          width: 3,
          background: railColor,
          flexShrink: 0,
          boxShadow: isActive || hovered || item.live ? `0 0 8px ${railColor}, 0 0 4px ${railColor}` : `0 0 2px ${railColor}66`,
          opacity: isActive ? 1 : hovered ? 0.95 : 0.75,
          transition: 'box-shadow 120ms ease-out, opacity 120ms ease-out',
        }}
      />

      {/* Body */}
      <div className="flex flex-col justify-center gap-1 px-2.5 py-2 min-w-0 flex-1">
        {/* Title line */}
        <div className="flex items-center gap-1.5 min-w-0">
          {item.pinned && (
            <span
              style={{
                color: 'var(--m-green-400, var(--theme-accent))',
                fontSize: 10,
                flexShrink: 0,
                textShadow: '0 0 4px var(--m-green-500, var(--theme-accent))',
              }}
            >
              ★
            </span>
          )}
          <span
            className="truncate"
            style={{
              color: isActive ? 'var(--m-green-400, var(--theme-accent))' : 'var(--theme-text)',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 12.5,
              fontWeight: isActive ? 600 : 500,
              letterSpacing: '0.01em',
              lineHeight: 1.35,
              textShadow: isActive ? `0 0 6px ${railColor}55` : 'none',
            }}
          >
            {item.title}
          </span>
        </div>

        {/* Meta row: src badge · sub */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="shrink-0 rounded-full px-1.5 uppercase"
            style={{
              border: `1px solid ${railColor}`,
              background: `color-mix(in srgb, ${railColor} 14%, transparent)`,
              color: railColor,
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 8,
              letterSpacing: '0.12em',
              fontWeight: 600,
              lineHeight: '14px',
              textShadow: `0 0 4px ${railColor}66`,
            }}
          >
            {item.src}
          </span>
          {item.sub && (
            <span
              className="truncate"
              style={{
                color: 'var(--theme-muted)',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 10,
                opacity: 0.65,
                letterSpacing: '0.02em',
              }}
            >
              {item.sub}
            </span>
          )}
        </div>
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
