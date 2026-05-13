import { lazy, Suspense } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { CubeIcon, CpuIcon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

const Matrix3DCanvas = lazy(() =>
  import('./components/matrix3d-canvas').then((mod) => ({
    default: mod.Matrix3DCanvas,
  })),
)

function StatusPill({ label, tone }: { label: string; tone: 'green' | 'amber' | 'slate' }) {
  const toneClass =
    tone === 'green'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      : tone === 'amber'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
        : 'border-white/10 bg-white/5 text-[var(--theme-muted)]'

  return (
    <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em]', toneClass)}>
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

export function Matrix3DScreen() {
  return (
    <div className="flex h-full flex-col overflow-auto bg-[var(--theme-bg)] text-[var(--theme-text)]">
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-5 p-4 md:p-6">
        <section className="relative overflow-hidden rounded-3xl border border-emerald-500/20 bg-[linear-gradient(135deg,rgba(6,78,59,0.28),rgba(3,7,18,0.94))] p-5 shadow-[0_20px_70px_rgba(0,0,0,0.35)] md:p-7">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.22),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.14),transparent_28%)]" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill label="Dedicated Page" tone="green" />
                <StatusPill label="Hermes-native" tone="green" />
                <StatusPill label="Claw3D homework done" tone="amber" />
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Matrix3D</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--theme-muted)] md:text-base">
                  A dedicated 3D operations room for Hermes sessions. This is the embedded path, not the separate-app detour. Same repo. Same shell. No spoon.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[360px]">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4 backdrop-blur-sm">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--theme-muted)]">Mode</div>
                <div className="mt-2 text-lg font-semibold text-emerald-300">Embedded Scene</div>
                <div className="mt-1 text-sm text-[var(--theme-muted)]">Runs inside SwitchUI. No sidecar process.</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--theme-muted)]">
                  <HugeiconsIcon icon={CpuIcon} className="size-4" />
                  Status
                </div>
                <div className="mt-2 text-lg font-semibold text-[var(--theme-text)]">Foundation Live</div>
                <div className="mt-1 text-sm text-[var(--theme-muted)]">Route, nav, shell, and a lightweight office scene are in place.</div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-h-[520px] rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 md:p-4">
            <Suspense fallback={<Matrix3DFallback />}>
              <Matrix3DCanvas />
            </Suspense>
          </div>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-muted)]">
                What shipped
              </div>
              <ul className="mt-3 space-y-3 text-sm leading-6 text-[var(--theme-muted)]">
                <li>Dedicated <code className="rounded bg-black/20 px-1.5 py-0.5 text-emerald-300">/matrix3d</code> route.</li>
                <li>Desktop nav and mobile nav integration.</li>
                <li>Lazy-loaded Three.js scene with office floor, desks, avatars, and orbit camera.</li>
                <li>Plan file saved in the repo at <code className="rounded bg-black/20 px-1.5 py-0.5 text-emerald-300">.hermes/plans/matrix3d-page.md</code>.</li>
              </ul>
            </div>

            <div className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-muted)]">
                Next useful moves
              </div>
              <ul className="mt-3 space-y-3 text-sm leading-6 text-[var(--theme-muted)]">
                <li>Wire live Hermes sessions into avatar placement.</li>
                <li>Add click-to-inspect drawer for session details.</li>
                <li>Port only the good bits from Claw3D's Hermes adapter. Skip the extra ceremony.</li>
              </ul>
            </div>
          </aside>
        </section>
      </div>
    </div>
  )
}
