import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { CubeIcon, CpuIcon, EyeIcon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { useMatrix3DStore } from './matrix3d-store'
import { useAgentPositions } from './hooks/use-agent-positions'

const Matrix3DCanvas = lazy(() =>
  import('./components/matrix3d-canvas').then((mod) => ({
    default: mod.Matrix3DCanvas,
  })),
)

const AgentDetailPanel = lazy(() =>
  import('./components/agent-detail-panel').then((mod) => ({
    default: mod.AgentDetailPanel,
  })),
)

// ── WebGL detection ──────────────────────────────────────────────

function isWebGL2Available(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return !!(
      canvas.getContext('webgl2') || canvas.getContext('experimental-webgl2')
    )
  } catch {
    return false
  }
}

// ── Small UI pieces ──────────────────────────────────────────────

function StatusPill({
  label,
  tone,
}: {
  label: string
  tone: 'green' | 'amber' | 'slate'
}) {
  const toneClass =
    tone === 'green'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      : tone === 'amber'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
        : 'border-white/10 bg-white/5 text-[var(--theme-muted)]'

  return (
    <span
      className={cn(
        'rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em]',
        toneClass,
      )}
    >
      {label}
    </span>
  )
}

function Matrix3DFallback() {
  return (
    <div className="relative flex h-full min-h-[420px] items-center justify-center overflow-hidden rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.16),_transparent_45%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent)]" />
      <div className="relative flex flex-col items-center gap-4 text-center">
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-300 shadow-[0_0_30px_rgba(16,185,129,0.12)]">
          <HugeiconsIcon icon={CubeIcon} className="size-10 animate-pulse" />
        </div>
        <div>
          <div className="text-sm font-semibold tracking-[0.18em] text-[var(--theme-text)] uppercase">
            Booting Matrix3D
          </div>
          <div className="mt-1 text-sm text-[var(--theme-muted)]">
            Spinning up the office layer.
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 2D fallback when WebGL unavailable ───────────────────────────

function Fallback2DGrid() {
  const { agents, loading } = useAgentPositions()

  return (
    <div className="flex h-full min-h-[520px] flex-col gap-4 overflow-auto rounded-[22px] border border-[var(--theme-border)] bg-[var(--theme-card)] p-5">
      <div className="flex items-center gap-2 text-sm text-amber-300">
        <HugeiconsIcon icon={EyeIcon} className="size-4" />
        3D view unavailable — falling back to list view
      </div>
      {loading && (
        <div className="py-8 text-center text-sm text-[var(--theme-muted)] animate-pulse">
          Loading sessions...
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="rounded-xl border border-[var(--theme-border)] bg-black/20 p-4"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[var(--theme-text)]">{agent.name}</span>
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider',
                  agent.status === 'active'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : agent.status === 'blocked'
                      ? 'border-red-500/30 bg-red-500/10 text-red-300'
                      : 'border-white/10 bg-white/5 text-slate-400',
                )}
              >
                {agent.status}
              </span>
            </div>
            <div className="mt-2 flex gap-4 text-xs text-[var(--theme-muted)]">
              <span>{agent.messageCount} msgs</span>
              <span>{agent.toolCallCount} tools</span>
              {agent.model && <span className="font-mono">{agent.model}</span>}
            </div>
          </div>
        ))}
      </div>
      {agents.length === 0 && !loading && (
        <div className="py-8 text-center text-sm text-[var(--theme-muted)]">
          No active sessions found.
        </div>
      )}
    </div>
  )
}

// ── Main screen ──────────────────────────────────────────────────

export function Matrix3DScreen() {
  const [webGL, setWebGL] = useState<boolean | null>(null)
  const { selectedAgentId, selectAgent, deselectAgent } = useMatrix3DStore()

  useEffect(() => {
    setWebGL(isWebGL2Available())
  }, [])

  const handleAgentSelect = useCallback(
    (id: string) => {
      // Toggle: clicking same agent deselects
      if (selectedAgentId === id) {
        deselectAgent()
      } else {
        selectAgent(id)
      }
    },
    [selectedAgentId, selectAgent, deselectAgent],
  )

  // Click on empty space dismisses panel (handled by canvas background click)
  const handleBackgroundClick = useCallback(() => {
    if (selectedAgentId) deselectAgent()
  }, [selectedAgentId, deselectAgent])

  return (
    <div className="flex h-full flex-col overflow-auto bg-[var(--theme-bg)] text-[var(--theme-text)]">
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-5 p-4 md:p-6">
        {/* Hero header */}
        <section className="relative overflow-hidden rounded-3xl border border-emerald-500/20 bg-[linear-gradient(135deg,rgba(6,78,59,0.28),rgba(3,7,18,0.94))] p-5 shadow-[0_20px_70px_rgba(0,0,0,0.35)] md:p-7">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.22),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.14),transparent_28%)]" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill label="Phase 2" tone="green" />
                <StatusPill label="Live Sessions" tone="green" />
                <StatusPill label="Agent Panel" tone="amber" />
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Matrix3D</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--theme-muted)] md:text-base">
                  Live 3D operations room wired to your Hermes sessions. Click an agent to inspect.
                  Same repo. Same shell. No spoon.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[360px]">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4 backdrop-blur-sm">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--theme-muted)]">
                  Mode
                </div>
                <div className="mt-2 text-lg font-semibold text-emerald-300">Embedded Scene</div>
                <div className="mt-1 text-sm text-[var(--theme-muted)]">
                  Runs inside SwitchUI. No sidecar process.
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--theme-muted)]">
                  <HugeiconsIcon icon={CpuIcon} className="size-4" />
                  Status
                </div>
                <div className="mt-2 text-lg font-semibold text-[var(--theme-text)]">
                  {webGL === null ? 'Detecting...' : webGL ? 'WebGL Active' : '2D Fallback'}
                </div>
                <div className="mt-1 text-sm text-[var(--theme-muted)]">
                  {webGL
                    ? 'GPU-accelerated 3D office with live agents.'
                    : 'WebGL unavailable — using session list.'}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3D scene + agent panel */}
        <section
          className={cn(
            'grid min-h-0 flex-1 gap-5 transition-all duration-300',
            selectedAgentId
              ? 'xl:grid-cols-[minmax(0,1fr)_380px]'
              : 'xl:grid-cols-[minmax(0,1fr)_0px]',
          )}
        >
          {/* Canvas area */}
          <div
            className="min-h-[520px] rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 md:p-4"
            onClick={handleBackgroundClick}
          >
            {webGL === null ? (
              <Matrix3DFallback />
            ) : webGL ? (
              <Suspense fallback={<Matrix3DFallback />}>
                <Matrix3DCanvas onAgentSelect={handleAgentSelect} />
              </Suspense>
            ) : (
              <Fallback2DGrid />
            )}
          </div>

          {/* Agent detail drawer (animated via grid transition) */}
          {selectedAgentId && (
            <Suspense fallback={null}>
              <AgentDetailPanel />
            </Suspense>
          )}
        </section>
      </div>
    </div>
  )
}
