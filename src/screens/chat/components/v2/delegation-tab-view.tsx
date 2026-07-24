import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useDelegationMessages, useDelegations } from '../../hooks/use-delegations'
import { ToolTabView } from './chat-tab-views-v2'
import type { Delegation, DelegationStatus } from '../../../../server/delegations'
import { BUILTIN_AGENTS } from '@/lib/builtin-agents'

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
const BUILTIN_AGENT_BY_ID = new Map(BUILTIN_AGENTS.map((agent) => [agent.id, agent]))

function fmtTs(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtTokens(tokens: number): string {
  if (tokens < 1_000) return `${tokens} tok`
  return `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}k tok`
}

function statusPresentation(status: DelegationStatus): {
  label: string
  color: string
  background: string
} {
  if (status === 'failed') {
    return {
      label: 'Needs attention',
      color: 'var(--theme-danger, #ef4444)',
      background: 'color-mix(in srgb, var(--theme-danger, #ef4444) 12%, transparent)',
    }
  }
  if (status === 'completed') {
    return {
      label: 'Completed',
      color: 'var(--m-info, #5fcfff)',
      background: 'color-mix(in srgb, var(--m-info, #5fcfff) 12%, transparent)',
    }
  }
  return {
    label: 'Working',
    color: 'var(--m-green-400, #3aff77)',
    background: 'color-mix(in srgb, var(--m-green-500, #00ff41) 12%, transparent)',
  }
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
  const status = statusPresentation(delegation.status)
  const isRunning = delegation.status === 'running'
  const detail = useDelegationMessages(open ? delegation.childSessionId : null)
  const totalTokens = delegation.inputTokens + delegation.outputTokens
  const assignedAgent = delegation.agentId ? BUILTIN_AGENT_BY_ID.get(delegation.agentId) : undefined
  const agentGlyph = assignedAgent?.glyph ?? delegation.agentId?.slice(0, 3).toUpperCase() ?? 'SUB'
  const agentName = assignedAgent?.name ?? delegation.agentId
  return (
    <div
      className="overflow-hidden rounded-lg border transition-colors hover:border-white/20"
      style={cardStyle}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`delegation-activity-${delegation.childSessionId}`}
        className="grid w-full grid-cols-[auto_3px_minmax(0,1fr)_auto] text-left font-mono text-xs transition-colors hover:bg-white/[0.025] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary"
        style={{ cursor: 'pointer', background: 'transparent', border: 'none' }}
      >
        <span className="flex items-start px-2.5 pt-3">
          <span
            role="img"
            aria-label={agentName ? `Assigned agent: ${agentName}` : 'Delegated subagent'}
            title={agentName ? `Assigned agent: ${agentName}` : 'Delegated subagent — profile identity is not reported'}
            className="flex size-8 shrink-0 items-center justify-center rounded-md border font-mono text-[10px] font-bold tracking-wide"
            style={{
              color: 'var(--m-green-400, #3aff77)',
              borderColor: 'color-mix(in srgb, var(--m-green-500, #00ff41) 45%, transparent)',
              background: 'color-mix(in srgb, var(--m-green-500, #00ff41) 10%, transparent)',
            }}
          >
            {agentGlyph}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="self-stretch"
          style={{
            background: status.color,
            boxShadow: isRunning
              ? `0 0 10px color-mix(in srgb, ${status.color} 55%, transparent)`
              : undefined,
          }}
        />
        <span className="min-w-0 px-3 py-3">
          <span className="flex items-start gap-2">
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 font-sans text-sm font-medium leading-5 text-foreground">
                {delegation.goal || 'Untitled agent task'}
              </span>
            </span>
            <span
              className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: status.color, background: status.background }}
            >
              <span
                aria-hidden="true"
                className={isRunning ? 'size-1.5 rounded-full session-attention-pulse' : 'size-1.5 rounded-full'}
                style={{ background: status.color }}
              />
              {status.label}
            </span>
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-4 opacity-55">
            <span className="max-w-[15rem] truncate">{delegation.model || 'unknown model'}</span>
            <span className="tabular-nums">{fmtTokens(totalTokens)}</span>
            <span className="tabular-nums">Started {fmtTs(delegation.startedAt)}</span>
          </span>
        </span>
        <span className="flex items-center self-stretch px-3 opacity-45" aria-hidden="true">
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </span>
      </button>
      {open ? (
        <div
          id={`delegation-activity-${delegation.childSessionId}`}
          className="border-t bg-black/[0.06] p-3"
          style={{ borderColor: 'var(--m-border, var(--theme-border))' }}
        >
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
  const runningCount = delegations.filter((delegation) => delegation.status === 'running').length

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
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[720px] flex-col border-l shadow-[-12px_0_32px_rgba(0,0,0,0.35)]"
        style={{ background: 'var(--theme-sidebar)', borderColor: 'var(--m-border, var(--theme-border))' }}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b px-4" style={{ borderColor: 'var(--m-border, var(--theme-border))' }}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-mono text-sm font-semibold" style={greenStyle}>Agents</h2>
              {runningCount > 0 ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold"
                  style={{
                    color: 'var(--m-green-400, #3aff77)',
                    background: 'color-mix(in srgb, var(--m-green-500, #00ff41) 12%, transparent)',
                  }}
                >
                  <span className="size-1.5 rounded-full session-attention-pulse" style={{ background: 'currentColor' }} />
                  {runningCount} live
                </span>
              ) : null}
            </div>
            <p className="font-mono text-[10px] opacity-50">
              {delegations.length === 0 ? 'Sub-agent work for this session' : `${delegations.length} delegated task${delegations.length === 1 ? '' : 's'} · select one for activity`}
            </p>
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
