import { useEffect, useState } from 'react'
import { useDelegationMessages, useDelegations } from '../../hooks/use-delegations'
import { ToolTabView } from './chat-tab-views-v2'
import type { Delegation, DelegationStatus } from '../../../../server/delegations'

type DelegationSidebarOverlayProps = {
  sessionKey: string
  onClose: () => void
}

const tabStyle: React.CSSProperties = {
  color: 'var(--m-muted, var(--theme-muted))',
}

const cardStyle: React.CSSProperties = {
  background: 'var(--m-surface-1, var(--theme-card))',
  borderColor: 'var(--m-border, var(--theme-border))',
}

const greenStyle: React.CSSProperties = { color: 'var(--m-green, #4ade80)' }

function fmtTs(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function statusColor(status: DelegationStatus): string {
  if (status === 'failed') return 'var(--theme-danger, #ef4444)'
  if (status === 'completed') return 'var(--theme-success, #22c55e)'
  return 'var(--theme-accent, #6366f1)'
}

function DelegationCard({
  delegation,
  open,
  onToggle,
}: {
  delegation: Delegation
  open: boolean
  onToggle: () => void
}) {
  const color = statusColor(delegation.status)
  const detail = useDelegationMessages(open ? delegation.childSessionId : null)

  return (
    <div className="rounded border overflow-hidden" style={cardStyle}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs"
        style={{ cursor: 'pointer', background: 'transparent', border: 'none' }}
      >
        <span className="font-semibold" style={greenStyle}>
          {delegation.goal || 'Untitled agent task'}
        </span>
        <span
          className="shrink-0 text-[10px] px-1.5 py-0.5 rounded"
          style={{
            background: 'color-mix(in srgb, var(--m-green, #4ade80) 12%, transparent)',
            color: 'var(--m-green, #4ade80)',
          }}
        >
          {delegation.model || 'unknown'}
        </span>
        <span className="flex-1" />
        <span className="shrink-0 opacity-40 text-[10px] tabular-nums">
          {delegation.inputTokens + delegation.outputTokens} tok
        </span>
        <span className="shrink-0 opacity-40 text-[10px] tabular-nums">
          {fmtTs(delegation.startedAt)}
        </span>
        <span
          className="shrink-0 text-[10px] px-1.5 py-0.5 rounded"
          style={{
            color,
            background: `color-mix(in srgb, ${color} 15%, transparent)`,
          }}
        >
          {delegation.status}
        </span>
      </button>
      {open ? (
        <div className="border-t p-2" style={{ borderColor: 'var(--m-border, var(--theme-border))' }}>
          {detail.isLoading ? <p className="p-2 opacity-40">Loading activity…</p> : null}
          {detail.error ? <p className="p-2" style={{ color: 'var(--theme-danger, #ef4444)' }}>{detail.error}</p> : null}
          {!detail.isLoading && !detail.error && detail.messages.length === 0 ? <p className="p-2 opacity-40">No activity recorded.</p> : null}
          {!detail.isLoading && !detail.error && detail.messages.length > 0 ? <ToolTabView messages={detail.messages} /> : null}
        </div>
      ) : null}
    </div>
  )
}

export function DelegationSidebarOverlay({ sessionKey, onClose }: DelegationSidebarOverlayProps) {
  const { delegations, isLoading, error } = useDelegations(sessionKey)
  const [openChildSessionId, setOpenChildSessionId] = useState<string | null>(null)

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <>
      <button
        type="button"
        aria-label="Close agents"
        className="fixed inset-0 z-40 cursor-default bg-black/30"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Agents"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[640px] flex-col border-l shadow-[-12px_0_32px_rgba(0,0,0,0.35)]"
        style={{ background: 'var(--theme-sidebar)', borderColor: 'var(--m-border, var(--theme-border))' }}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b px-4" style={{ borderColor: 'var(--m-border, var(--theme-border))' }}>
          <div>
            <h2 className="font-mono text-sm font-semibold" style={greenStyle}>Agents</h2>
            <p className="font-mono text-[10px] opacity-50">Sub-agent work for this session</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close agents"
            className="rounded border px-2 py-1 font-mono text-xs opacity-70 hover:opacity-100"
            style={{ borderColor: 'var(--m-border, var(--theme-border))' }}
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto font-mono text-xs" style={tabStyle}>
          {isLoading && delegations.length === 0 ? (
            <div className="flex items-start justify-center p-4 pt-8">
              <p className="opacity-40 text-center">Loading agents…</p>
            </div>
          ) : error ? (
            <div className="flex items-start justify-center p-4 pt-8">
              <p className="text-center" style={{ color: 'var(--theme-danger, #ef4444)' }}>
                {error}
              </p>
            </div>
          ) : delegations.length === 0 ? (
            <div className="flex items-start justify-center p-4 pt-8">
              <p className="opacity-40 text-center">∅ No agents in this session</p>
            </div>
          ) : (
            <div className="space-y-2 p-4 pt-3">
              {delegations.map((delegation) => (
                <DelegationCard
                  key={delegation.childSessionId}
                  delegation={delegation}
                  open={openChildSessionId === delegation.childSessionId}
                  onToggle={() => setOpenChildSessionId((current) => current === delegation.childSessionId ? null : delegation.childSessionId)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
