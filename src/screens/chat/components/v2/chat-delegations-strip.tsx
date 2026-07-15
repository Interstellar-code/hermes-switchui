import { useEffect, useMemo, useState } from 'react'
import {
  formatDelegationElapsed,
  getVisibleChatDelegations,
} from '../../chat-delegations'
import { useDelegationMessages } from '../../hooks/use-delegations'
import { ToolTabView } from './chat-tab-views-v2'
import type {
  ChatDelegationEntry,
  ChatDelegationStatus,
} from '../../chat-delegations'

export type ChatDelegationsProps = {
  delegations: Array<ChatDelegationEntry>
  onOpenDelegation?: (childSessionKey: string) => void
}

const statusColor: Record<ChatDelegationStatus, string> = {
  spawned: 'var(--theme-accent, #6366f1)',
  running: 'var(--theme-accent, #6366f1)',
  completed: 'var(--theme-success, #22c55e)',
  failed: 'var(--theme-danger, #ef4444)',
}

function StatusDot({ status }: { status: ChatDelegationStatus }) {
  const color = statusColor[status]
  if (status === 'running' || status === 'spawned') {
    return (
      <span className="relative flex h-2 w-2 shrink-0">
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
          style={{ background: color }}
        />
        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
      </span>
    )
  }
  return <span className="inline-flex h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
}

function DelegationCard({
  entry,
  onOpen,
}: {
  entry: ChatDelegationEntry
  onOpen?: () => void
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (entry.status !== 'running' && entry.status !== 'spawned') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [entry.status])

  const elapsed =
    entry.status === 'running' || entry.status === 'spawned'
      ? Math.max(0, now - entry.startedAt)
      : entry.elapsedMs
  const clickable = Boolean(onOpen && entry.childSessionKey)
  const agentLabel = entry.agentName || 'sub-agent'
  const tokenLabel = entry.tokenCount > 0 ? `${entry.tokenCount.toLocaleString()} tokens` : null
  const sessionLabel = entry.childSessionKey
    ? `${entry.childSessionKey.slice(0, 8)}${entry.childSessionKey.length > 8 ? '…' : ''}`
    : null

  return (
    <div
      className="flex flex-col gap-1 rounded-md border px-3 py-2 text-xs"
      style={{
        borderColor: 'var(--m-border, var(--theme-border))',
        background: 'var(--m-surface-1, var(--theme-card))',
        cursor: clickable ? 'pointer' : 'default',
      }}
      onClick={clickable ? onOpen : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onOpen?.()
            }
          : undefined
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot status={entry.status} />
        <span className="shrink-0 font-semibold capitalize">
          {agentLabel.replace(/[_-]+/g, ' ')}
        </span>
        <span
          className="shrink-0 font-mono text-[10px] uppercase tracking-wide"
          style={{ color: statusColor[entry.status] }}
        >
          {entry.status}
        </span>
        <span className="flex-1" />
        {entry.label ? (
          <span
            className="max-w-40 shrink-0 truncate rounded border px-1.5 py-0.5 font-mono text-[10px]"
            style={{
              borderColor: 'var(--m-border, var(--theme-border))',
              color: 'var(--m-muted, var(--theme-muted))',
            }}
          >
            {entry.label}
          </span>
        ) : null}
        <span
          className="shrink-0 font-mono text-[11px] tabular-nums"
          style={{ color: 'var(--m-muted, var(--theme-muted))' }}
        >
          {formatDelegationElapsed(elapsed)}
        </span>
      </div>
      <div className="truncate pl-4 font-medium" title={entry.task || undefined}>
        {entry.task || 'Delegate task'}
      </div>
      {entry.latestActivity ? (
        <div className="truncate pl-4 font-mono text-[10px] opacity-70" title={entry.latestActivity}>
          {entry.toolCount ? `${entry.toolCount} tools · ` : ''}{entry.latestActivity}
        </div>
      ) : null}
      {tokenLabel || sessionLabel || entry.error ? (
        <div
          className="flex min-w-0 items-center gap-2 pl-4 font-mono text-[10px]"
          style={{ color: entry.error ? 'var(--theme-danger, #ef4444)' : 'var(--m-muted, var(--theme-muted))' }}
        >
          {tokenLabel ? <span>{tokenLabel}</span> : null}
          {tokenLabel && sessionLabel ? <span aria-hidden>·</span> : null}
          {sessionLabel ? <span title={entry.childSessionKey}>session {sessionLabel}</span> : null}
          {entry.error ? <span className="truncate">{entry.error}</span> : null}
          {clickable ? <span className="ml-auto shrink-0">Open ›</span> : null}
        </div>
      ) : null}
    </div>
  )
}

function DelegationActivity({ childSessionKey, onClose }: { childSessionKey: string; onClose: () => void }) {
  const detail = useDelegationMessages(childSessionKey)
  return (
    <div className="rounded-md border p-2" style={{ borderColor: 'var(--m-border, var(--theme-border))', background: 'var(--m-surface-2, var(--theme-card2, var(--theme-card)))' }}>
      <div className="mb-2 flex items-center justify-between px-1 font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--m-muted, var(--theme-muted))' }}>
        <span>Delegation activity</span>
        <button type="button" onClick={onClose} className="opacity-60 hover:opacity-100" aria-label="Collapse delegation activity">✕</button>
      </div>
      {detail.isLoading ? <p className="px-1 py-2 font-mono text-[10px] opacity-50">Loading activity…</p> : null}
      {detail.error ? <p className="px-1 py-2 font-mono text-[10px]" style={{ color: 'var(--theme-danger, #ef4444)' }}>{detail.error}</p> : null}
      {!detail.isLoading && !detail.error && detail.messages.length === 0 ? <p className="px-1 py-2 font-mono text-[10px] opacity-50">No activity yet.</p> : null}
      {!detail.isLoading && !detail.error && detail.messages.length > 0 ? <ToolTabView messages={detail.messages} /> : null}
    </div>
  )
}

/** Docked, collapsible strip directly above the composer showing live
 * sub-agent delegations (display-only: no cancel/resume/retry). */
export function ChatDelegations({ delegations, onOpenDelegation }: ChatDelegationsProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [openChildSessionKey, setOpenChildSessionKey] = useState<string | null>(null)
  const visible = useMemo(() => getVisibleChatDelegations(delegations), [delegations])
  const selected = visible.some((entry) => entry.childSessionKey === openChildSessionKey)
    ? openChildSessionKey
    : null
  if (visible.length === 0) return null

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-2 pt-1">
      <div
        className="rounded-lg border"
        style={{
          borderColor: 'var(--m-border, var(--theme-border))',
          background: 'var(--m-surface-1, var(--theme-card))',
        }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex w-full items-center gap-2 px-3 py-2 text-xs"
          style={{ color: 'var(--m-muted, var(--theme-muted))' }}
        >
          <span>{collapsed ? '▶' : '▼'}</span>
          <span className="font-medium">Sub-agent delegations</span>
          <span className="ml-1" style={{ color: 'var(--theme-accent, #6366f1)' }}>
            {visible.length} visible
          </span>
        </button>

        {!collapsed ? (
          <div className="flex flex-col gap-2 px-3 pb-3">
            {visible.map((entry) => (
              <DelegationCard
                key={entry.id}
                entry={entry}
                onOpen={
                  entry.childSessionKey
                    ? () => {
                        const next = selected === entry.childSessionKey ? null : entry.childSessionKey
                        setOpenChildSessionKey(next)
                        onOpenDelegation?.(next ?? entry.childSessionKey)
                      }
                    : undefined
                }
              />
            ))}
            {selected ? <DelegationActivity childSessionKey={selected} onClose={() => setOpenChildSessionKey(null)} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
