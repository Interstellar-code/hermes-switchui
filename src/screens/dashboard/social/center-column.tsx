import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  BrainIcon,
  BubbleChatIcon,
  CheckListIcon,
  Clock01Icon,
  ServerStack01Icon,
  SparklesIcon,
  WorkflowSquare01Icon,
} from '@hugeicons/core-free-icons'
import { ApproveDialog, RejectDialog } from './approval-dialogs'
import { Chip, CountRing, Panel, SectionHeading } from './primitives'
import type { ReactNode } from 'react'
import type { ApprovalItem } from './approval-dialogs'
import type {
  DashboardSocial,
  NeedsYouItem,
  RecentItem,
} from '@/types/dashboard-social'

type CenterColumnProps = {
  data: Pick<DashboardSocial, 'counts' | 'needsYou' | 'recent'>
  /** Called after any successful action so the caller can refetch. */
  onChanged?: () => void
  className?: string
}

const KIND_COLOR: Record<RecentItem['kind'], string> = {
  chat: 'var(--dash-cat-chat)',
  workflow: 'var(--dash-cat-workflow)',
  cron: 'var(--dash-cat-cron)',
  task: 'var(--dash-cat-task)',
  memory: 'var(--dash-cat-memory)',
  badge: 'var(--dash-podium-1)',
}

function hhmm(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--:--'
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function Unavailable() {
  return (
    <p className="mt-2 text-[11px]" style={{ color: 'var(--theme-muted)' }}>
      Unavailable
    </p>
  )
}

function Icon({ icon }: { icon: typeof BrainIcon }) {
  return <HugeiconsIcon icon={icon} size={22} />
}

function Rings({ counts }: { counts: DashboardSocial['counts'] }) {
  return (
    <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
      <CountRing
        href="/chat"
        label="Chats"
        color="var(--dash-cat-chat)"
        icon={<Icon icon={BubbleChatIcon} />}
        count={counts?.chats}
      />
      <CountRing
        href="#needs"
        label="Needs you"
        color="var(--dash-cat-needs)"
        icon={<Icon icon={Alert02Icon} />}
        count={counts?.needsYou}
      />
      <CountRing
        href="/workflows"
        label="Workflows"
        color="var(--dash-cat-workflow)"
        icon={<Icon icon={WorkflowSquare01Icon} />}
        count={counts?.workflows}
      />
      <CountRing
        href="/jobs"
        label="Cron"
        color="var(--dash-cat-cron)"
        icon={<Icon icon={Clock01Icon} />}
        count={counts?.cron}
      />
      <CountRing
        href="/tasks"
        label="Tasks"
        color="var(--dash-cat-task)"
        icon={<Icon icon={CheckListIcon} />}
        count={counts?.tasks}
      />
      <CountRing
        href="/memory"
        label="Memory"
        color="var(--dash-cat-memory)"
        icon={<Icon icon={BrainIcon} />}
        count={counts?.memory}
      />
      <CountRing
        href="/self-improve"
        label="Self-improve"
        color="var(--dash-cat-improve)"
        icon={<Icon icon={SparklesIcon} />}
        count={counts?.selfImprove}
      />
      <CountRing
        href="/operations"
        label="Gateway"
        color="var(--dash-cat-gateway)"
        icon={<Icon icon={ServerStack01Icon} />}
        ok={counts?.gatewayOk}
      />
    </div>
  )
}

function AskBox() {
  const [text, setText] = useState('')

  function submit(e: { preventDefault: () => void }) {
    e.preventDefault()
    // No draft hand-off exists on /chat/new (the route only reads `?profile=`),
    // so the text is not carried over; inventing one is out of scope.
    window.location.assign('/chat/new')
  }

  const btn =
    'rounded border px-3 py-1.5 text-[10px] font-extrabold no-underline'
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label className="sr-only" htmlFor="dash-ask">
        Ask hermes-switch something…
      </label>
      <input
        id="dash-ask"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ask hermes-switch something…"
        className="w-full rounded-lg border px-3 py-2 text-[13px]"
        style={{
          background: 'var(--theme-panel)',
          borderColor: 'var(--theme-border)',
          color: 'var(--theme-text)',
        }}
      />
      <div className="flex flex-wrap gap-2">
        <a
          href="/workflows"
          className={btn}
          style={{
            borderColor: 'var(--dash-cat-workflow)',
            color: 'var(--dash-cat-workflow)',
          }}
        >
          RUN WORKFLOW
        </a>
        <a
          href="/tasks"
          className={btn}
          style={{
            borderColor: 'var(--dash-cat-task)',
            color: 'var(--dash-cat-task)',
          }}
        >
          ADD TASK
        </a>
      </div>
    </form>
  )
}

const actionBtn =
  'rounded border px-2.5 py-1 text-[10px] font-extrabold no-underline disabled:opacity-50'

function ApprovalRow({
  item,
  onChanged,
}: {
  item: ApprovalItem
  onChanged?: () => void
}) {
  const [open, setOpen] = useState<null | 'approve' | 'reject'>(null)
  const [result, setResult] = useState<string | null>(null)
  const done = (decision: 'approved' | 'rejected') => {
    setOpen(null)
    setResult(decision === 'approved' ? 'Approved — resuming' : 'Rejected')
    onChanged?.()
  }
  return (
    <NeedRow
      title={`${item.workflow} is waiting for you`}
      chip={<Chip color="var(--dash-cat-needs)">APPROVAL</Chip>}
      sub={`paused at ${item.pausedAt} · ${item.progress}`}
    >
      {result ? (
        <span className="text-[11px]" role="status">
          {result}
        </span>
      ) : (
        <>
          <button
            type="button"
            className={actionBtn}
            style={{
              borderColor: 'var(--theme-success)',
              color: 'var(--theme-success)',
            }}
            onClick={() => setOpen('approve')}
          >
            APPROVE…
          </button>
          <button
            type="button"
            className={actionBtn}
            style={{
              borderColor: 'var(--theme-danger)',
              color: 'var(--theme-danger)',
            }}
            onClick={() => setOpen('reject')}
          >
            REJECT…
          </button>
          <a
            href="/conductor"
            className={actionBtn}
            style={{ borderColor: 'var(--theme-border)' }}
          >
            OPEN IN CONDUCTOR →
          </a>
        </>
      )}
      {open === 'approve' ? (
        <ApproveDialog
          item={item}
          onClose={() => setOpen(null)}
          onDone={done}
        />
      ) : null}
      {open === 'reject' ? (
        <RejectDialog item={item} onClose={() => setOpen(null)} onDone={done} />
      ) : null}
    </NeedRow>
  )
}

function CronRow({
  item,
  onChanged,
}: {
  item: Extract<NeedsYouItem, { kind: 'cron-failing' }>
  onChanged?: () => void
}) {
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  async function retry() {
    setPending(true)
    setMsg(null)
    try {
      const res = await fetch(
        `/api/claude-jobs/${encodeURIComponent(item.jobId)}?action=run`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      )
      if (!res.ok) {
        let m = `Request failed (${res.status})`
        try {
          const body = (await res.json()) as { error?: unknown }
          if (typeof body.error === 'string' && body.error) m = body.error
        } catch {
          // keep generic message
        }
        setFailed(true)
        setMsg(m)
        return
      }
      setFailed(false)
      setMsg('Retry started')
      onChanged?.()
    } catch {
      setFailed(true)
      setMsg('Network error. Try again.')
    } finally {
      setPending(false)
    }
  }
  return (
    <NeedRow
      title={`${item.name} failed ${item.failures} runs in a row`}
      chip={<Chip color="var(--theme-danger)">CRON</Chip>}
      sub={item.lastError}
    >
      <button
        type="button"
        className={actionBtn}
        disabled={pending}
        style={{
          borderColor: 'var(--dash-cat-cron)',
          color: 'var(--dash-cat-cron)',
        }}
        onClick={retry}
      >
        RETRY NOW
      </button>
      <a
        href="/jobs"
        className={actionBtn}
        style={{ borderColor: 'var(--theme-border)' }}
      >
        VIEW LOG
      </a>
      {msg ? (
        <span
          role={failed ? 'alert' : 'status'}
          className="text-[11px]"
          style={failed ? { color: 'var(--theme-danger)' } : undefined}
        >
          {msg}
        </span>
      ) : null}
    </NeedRow>
  )
}

function NeedRow({
  title,
  chip,
  sub,
  children,
}: {
  title: string
  chip: ReactNode
  sub: string
  children: ReactNode
}) {
  return (
    <li
      className="flex flex-col gap-1.5 border-t py-2 first:border-t-0"
      style={{ borderColor: 'var(--theme-border)' }}
    >
      <div className="flex items-center gap-2 text-[12px] font-bold">
        {title}
        {chip}
      </div>
      <div className="text-[11px]" style={{ color: 'var(--theme-muted)' }}>
        {sub}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </li>
  )
}

function NeedsYou({
  items,
  onChanged,
}: {
  items: DashboardSocial['needsYou']
  onChanged?: () => void
}) {
  return (
    <Panel as="section" tone="warning" id="needs" aria-labelledby="needs-h">
      <SectionHeading id="needs-h" count={items?.length}>
        NEEDS YOU
      </SectionHeading>
      {items === null ? (
        <Unavailable />
      ) : items.length === 0 ? (
        <p className="mt-2 text-[11px]" style={{ color: 'var(--theme-muted)' }}>
          All caught up. New approvals, failures and agent questions land here
          first.
        </p>
      ) : (
        <ul className="mt-2 list-none p-0">
          {items.map((item) => {
            if (item.kind === 'approval') {
              return (
                <ApprovalRow
                  key={`a:${item.runId}:${item.nodeRunId}`}
                  item={item}
                  onChanged={onChanged}
                />
              )
            }
            if (item.kind === 'cron-failing') {
              return (
                <CronRow
                  key={`c:${item.jobId}`}
                  item={item}
                  onChanged={onChanged}
                />
              )
            }
            return (
              <NeedRow
                key={`t:${item.taskId}`}
                title={item.title}
                chip={<Chip color="var(--dash-cat-task)">TASK</Chip>}
                sub={`needs review · ${item.board}`}
              >
                <a
                  href="/tasks"
                  className={actionBtn}
                  style={{ borderColor: 'var(--theme-border)' }}
                >
                  OPEN CARD
                </a>
              </NeedRow>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function Recent({ items }: { items: DashboardSocial['recent'] }) {
  return (
    <Panel as="section" aria-labelledby="recent-h">
      <SectionHeading
        id="recent-h"
        action={
          // TODO(feed): link to /feed once the route exists.
          <span className="text-[10px]" style={{ color: 'var(--theme-muted)' }}>
            see all in Feed
          </span>
        }
      >
        RECENT ACTIVITY
      </SectionHeading>
      {items === null ? (
        <Unavailable />
      ) : items.length === 0 ? (
        <p className="mt-2 text-[11px]" style={{ color: 'var(--theme-muted)' }}>
          Nothing yet.
        </p>
      ) : (
        <ul className="mt-2 list-none p-0">
          {items.slice(0, 5).map((r) => (
            <li key={`${r.at}:${r.href}`}>
              <a
                href={r.href}
                className="flex items-center gap-2 py-1 text-[12px] no-underline"
                style={{ color: 'var(--theme-text)' }}
              >
                <time dateTime={r.at} style={{ color: 'var(--theme-muted)' }}>
                  {hhmm(r.at)}
                </time>
                <span
                  data-testid="recent-dot"
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: KIND_COLOR[r.kind] }}
                />
                <span className="font-bold">{r.title}</span>
                <span style={{ color: 'var(--theme-muted)' }}>{r.sub}</span>
                <span
                  className="ml-auto"
                  style={{ color: 'var(--theme-muted)' }}
                >
                  {r.who}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

export function CenterColumn({
  data,
  onChanged,
  className,
}: CenterColumnProps) {
  return (
    <main
      aria-label="Act now"
      className={['flex flex-col gap-4', className].filter(Boolean).join(' ')}
    >
      <Rings counts={data.counts} />
      <AskBox />
      <NeedsYou items={data.needsYou} onChanged={onChanged} />
      <Recent items={data.recent} />
    </main>
  )
}
