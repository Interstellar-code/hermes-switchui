import { useState } from 'react'
import { useDelegations } from '../../hooks/use-delegations'
import { DelegationDetailModal } from './delegation-detail-modal'
import type { Delegation, DelegationStatus } from '../../../../server/delegations'

type DelegationTabViewProps = {
  sessionKey: string
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

/** Expanding a card now opens the shared `DelegationDetailModal` (one modal,
 * shared with the docked delegations strip) instead of an inline transcript. */
function DelegationCard({
  delegation,
  onOpen,
}: {
  delegation: Delegation
  onOpen: () => void
}) {
  const color = statusColor(delegation.status)

  return (
    <div className="rounded border overflow-hidden" style={cardStyle}>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs"
        style={{ cursor: 'pointer', background: 'transparent', border: 'none' }}
      >
        <span className="font-semibold" style={greenStyle}>
          {delegation.goal || 'Untitled delegation'}
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
    </div>
  )
}

export function DelegationTabView({ sessionKey }: DelegationTabViewProps) {
  const { delegations, isLoading, error } = useDelegations(sessionKey)
  const [openChildSessionId, setOpenChildSessionId] = useState<string | null>(null)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col font-mono text-xs" style={tabStyle}>
      {isLoading && delegations.length === 0 ? (
        <div className="flex-1 flex items-start justify-center pt-8 p-4">
          <p className="opacity-40 text-center">Loading delegations…</p>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-start justify-center pt-8 p-4">
          <p className="text-center" style={{ color: 'var(--theme-danger, #ef4444)' }}>
            {error}
          </p>
        </div>
      ) : delegations.length === 0 ? (
        <div className="flex-1 flex items-start justify-center pt-8 p-4">
          <p className="opacity-40 text-center">∅ No delegations in this session</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 p-4 pt-3 space-y-2">
          {delegations.map((delegation) => (
            <DelegationCard
              key={delegation.childSessionId}
              delegation={delegation}
              onOpen={() => setOpenChildSessionId(delegation.childSessionId)}
            />
          ))}
        </div>
      )}
      <DelegationDetailModal
        childSessionId={openChildSessionId}
        onClose={() => setOpenChildSessionId(null)}
      />
    </div>
  )
}
