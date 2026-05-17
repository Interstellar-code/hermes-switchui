import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  Cancel01Icon,
  CpuIcon,
  MessageMultiple01Icon,
  PackageIcon,
} from '@hugeicons/core-free-icons'
import { useMatrix3DStore } from '../matrix3d-store'
import { useAgentPositions } from '../hooks/use-agent-positions'

function statusTone(status: string) {
  if (status === 'active') return 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30'
  if (status === 'blocked') return 'text-red-300 bg-red-500/15 border-red-500/30'
  return 'text-slate-300 bg-white/5 border-white/10'
}

/** Right-side detail drawer for a selected agent. */
export function AgentDetailPanel() {
  const { selectedAgentId, deselectAgent } = useMatrix3DStore()
  const { agents } = useAgentPositions()

  const agent = agents.find((a) => a.id === selectedAgentId)

  if (!agent) return null

  return (
    <div className="flex h-full flex-col rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-card)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-300">
            <HugeiconsIcon icon={CpuIcon} className="size-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-[var(--theme-text)]">{agent.name}</div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--theme-muted)]">
              Session
            </div>
          </div>
        </div>
        <button
          onClick={deselectAgent}
          className="rounded-lg p-1.5 text-[var(--theme-muted)] transition-colors hover:bg-white/5 hover:text-[var(--theme-text)]"
        >
          <HugeiconsIcon icon={Cancel01Icon} className="size-4" />
        </button>
      </div>

      {/* Status pill */}
      <div className="px-5 pt-4">
        <span
          className={`inline-block rounded-full border px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] ${statusTone(agent.status)}`}
        >
          {agent.status}
        </span>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3 px-5 pt-4">
        <MetricCard
          icon={<HugeiconsIcon icon={MessageMultiple01Icon} className="size-4" />}
          label="Messages"
          value={String(agent.messageCount)}
        />
        <MetricCard
          icon={<HugeiconsIcon icon={PackageIcon} className="size-4" />}
          label="Tool Calls"
          value={String(agent.toolCallCount)}
        />
      </div>

      {/* Session info */}
      <div className="mt-4 space-y-3 px-5">
        <InfoRow label="Session Key" value={agent.id} mono />
        <InfoRow label="Desk" value={agent.deskLabel} />
        <InfoRow label="Model" value={agent.model ?? 'default'} mono />
        <InfoRow label="Origin" value={agent.origin} />
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Footer action */}
      <div className="border-t border-[var(--theme-border)] px-5 py-4">
        <button className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500/15 px-4 py-2.5 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/25">
          <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
          Open Session
        </button>
      </div>
    </div>
  )
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-[var(--theme-border)] bg-black/20 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[var(--theme-muted)]">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-lg font-semibold text-[var(--theme-text)]">{value}</div>
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-[var(--theme-muted)]">{label}</span>
      <span
        className={`max-w-[180px] truncate text-xs text-[var(--theme-text)] ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </span>
    </div>
  )
}
