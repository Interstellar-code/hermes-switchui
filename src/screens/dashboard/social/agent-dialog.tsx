import { useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AgentAvatar } from './primitives'
import type { DashboardAgent } from '@/types/dashboard-social'
import { useFocusTrap } from '@/components/ui/use-focus-trap'

/** Mockup formatting: 4.2M / 86k / 993. */
function compact(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return String(n)
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className="inline-flex h-[26px] w-[28px] cursor-pointer items-center justify-center rounded border bg-transparent p-0"
      style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <path d="M3 3l10 10M13 3L3 13" />
      </svg>
    </button>
  )
}

const GHOST_BUTTON =
  'inline-flex cursor-pointer items-center gap-1.5 rounded border bg-transparent px-2 py-1 text-[9px] tracking-[0.1em] no-underline'
const SOLID_BUTTON =
  'inline-flex cursor-pointer items-center gap-1.5 rounded border bg-transparent px-2 py-1 text-[9px] tracking-[0.1em] font-extrabold no-underline'

/** One agent's profile: rank, weekly stats, most used tools, profile links. */
export function AgentDialog({
  agent,
  rank,
  open,
  onClose,
}: {
  /** null renders an unavailable empty state. */
  agent: DashboardAgent | null
  /** Leaderboard rank, when the dialog was opened from the podium or a row. */
  rank: number | null
  open: boolean
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useFocusTrap(open, dialogRef, onClose)

  if (!open) return null

  const stateLabel = agent?.working ? 'working now' : 'idle'
  const stats: Array<[string, string]> = agent
    ? [
        ['SESSIONS', String(agent.sessions)],
        ['TOKENS / WK', compact(agent.tokensWeek)],
        ['TASKS / WK', String(agent.tasksWeek)],
        ['RUNS / WK', String(agent.runsWeek)],
      ]
    : []

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[110px]"
      style={{ background: 'var(--theme-glass)' }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        className="w-[min(520px,100%)] overflow-hidden rounded-[10px] border"
        style={{
          borderColor: 'var(--theme-accent-border)',
          background: 'var(--theme-panel)',
          boxShadow: 'var(--theme-shadow-3)',
        }}
      >
        <div
          className="flex items-center gap-3 border-b p-[14px] px-4"
          style={{ borderColor: 'var(--theme-border)' }}
        >
          <div className="flex items-center gap-3">
            {agent ? (
              <AgentAvatar
                initials={agent.initials}
                color="var(--theme-accent)"
                size={52}
                working={agent.working}
              />
            ) : null}
            <div>
              <h2 id={titleId} className="text-[13px] font-extrabold">
                {agent?.id ?? 'Agent profile'}
              </h2>
              <p
                className="text-[10px]"
                style={{ color: 'var(--theme-muted)' }}
              >
                {agent
                  ? `agent profile · ${stateLabel}`
                  : 'no profile selected'}
              </p>
            </div>
          </div>
          <span className="grow" />
          {agent && rank !== null ? (
            <span
              className="rounded-full px-[9px] py-0.5 text-[9px] font-extrabold tracking-[0.14em]"
              style={{
                background: 'var(--theme-accent)',
                color: 'var(--theme-bg)',
              }}
            >
              RANK {rank}
            </span>
          ) : null}
          <CloseButton onClose={onClose} />
        </div>

        <div className="flex flex-col gap-3 p-[14px] px-4">
          {agent ? (
            <>
              <div className="grid grid-cols-4 gap-2">
                {stats.map(([label, value]) => (
                  <div
                    key={label}
                    className="flex flex-col gap-0.5 rounded-md border p-2"
                    style={{ borderColor: 'var(--theme-border)' }}
                  >
                    <b className="text-[15px] font-extrabold">{value}</b>
                    <span
                      className="text-[8.5px] tracking-[0.12em]"
                      style={{ color: 'var(--theme-muted)' }}
                    >
                      {label}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-[5px]">
                <span
                  className="text-[9px] tracking-[0.14em]"
                  style={{ color: 'var(--theme-muted)' }}
                >
                  MOST USED TOOLS
                </span>
                <div className="flex flex-wrap gap-[5px]">
                  {agent.topTools.length > 0 ? (
                    agent.topTools.map((tool) => (
                      <span
                        key={tool}
                        className="rounded-[3px] border px-[7px] py-0.5 text-[9.5px]"
                        style={{
                          borderColor: 'var(--theme-border)',
                          color: 'var(--theme-text)',
                        }}
                      >
                        {tool}
                      </span>
                    ))
                  ) : (
                    <span
                      className="text-[9.5px]"
                      style={{ color: 'var(--theme-muted)' }}
                    >
                      No tool use recorded this week.
                    </span>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p
              className="text-[10.5px]"
              style={{ color: 'var(--theme-muted)' }}
            >
              <span style={{ color: 'var(--theme-text)' }}>Unavailable</span> —
              this agent profile could not be loaded.
            </p>
          )}
        </div>

        <div
          className="flex flex-wrap items-center gap-2 border-t px-4 py-3"
          style={{
            borderColor: 'var(--theme-border)',
            background: 'var(--theme-sidebar)',
          }}
        >
          <a
            className={GHOST_BUTTON}
            href="/profiles"
            style={{
              borderColor: 'var(--theme-border)',
              color: 'var(--theme-text)',
            }}
          >
            OPEN PROFILE
          </a>
          <span className="grow" />
          {agent ? (
            <a
              className={SOLID_BUTTON}
              href="/chat"
              style={{
                borderColor: 'var(--theme-accent)',
                background: 'var(--theme-accent)',
                color: 'var(--theme-bg)',
              }}
            >
              NEW CHAT WITH {agent.id} →
            </a>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
