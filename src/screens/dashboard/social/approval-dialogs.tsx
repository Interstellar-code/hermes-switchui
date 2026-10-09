import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { NeedsYouItem } from '@/types/dashboard-social'

export type ApprovalItem = Extract<NeedsYouItem, { kind: 'approval' }>

type DialogProps = {
  item: ApprovalItem
  onClose: () => void
  /** Called after the server accepted the decision. */
  onDone: (decision: 'approved' | 'rejected') => void
}

const FOCUSABLE =
  'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), a[href]'

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error) return body.error
  } catch {
    // fall through to the generic message
  }
  return `Request failed (${res.status})`
}

function Shell({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)

  // Focus the first control on open; give focus back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    return () => opener?.focus()
  }, [])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const nodes = ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
    if (!nodes?.length) return
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    const active = document.activeElement
    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: 'color-mix(in srgb, var(--theme-bg) 70%, transparent)',
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="w-full max-w-md rounded-lg border p-4"
        style={{
          background: 'var(--theme-panel)',
          borderColor: 'var(--theme-border)',
          color: 'var(--theme-text)',
        }}
      >
        <h2
          id={titleId}
          className="mb-3 text-[13px] font-extrabold tracking-[0.12em]"
          style={{ color: 'var(--theme-accent)' }}
        >
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}

function DecisionDialog({
  item,
  onClose,
  onDone,
  decision,
}: DialogProps & { decision: 'approved' | 'rejected' }) {
  const approving = decision === 'approved'
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fieldId = useId()
  const blocked = pending || (!approving && !text.trim())

  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault()
    if (blocked) return
    setPending(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/workflow-runs/${encodeURIComponent(item.runId)}/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            node_run_id: item.nodeRunId,
            decision,
            response: text,
          }),
        },
      )
      if (!res.ok) {
        setError(await errorMessage(res))
        setPending(false)
        return
      }
      onDone(decision)
    } catch {
      setError('Network error. Try again.')
      setPending(false)
    }
  }

  return (
    <Shell title={approving ? 'APPROVE RUN' : 'REJECT RUN'} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3 text-[12px]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt style={{ color: 'var(--theme-muted)' }}>Workflow</dt>
          <dd>
            {item.workflow} · {item.version}
          </dd>
          <dt style={{ color: 'var(--theme-muted)' }}>Run</dt>
          <dd className="break-all">{item.runId}</dd>
          <dt style={{ color: 'var(--theme-muted)' }}>Paused at</dt>
          <dd>{item.pausedAt}</dd>
          <dt style={{ color: 'var(--theme-muted)' }}>Agent</dt>
          <dd>{item.agent}</dd>
        </dl>
        {approving ? (
          <p
            className="rounded border p-2"
            style={{
              borderColor: 'var(--dash-cat-needs)',
              color: 'var(--dash-cat-needs)',
            }}
          >
            Next: {item.next}
          </p>
        ) : null}
        <label htmlFor={fieldId} className="flex flex-col gap-1">
          <span style={{ color: 'var(--theme-muted)' }}>
            {approving ? 'Note (optional)' : 'Reason (required)'}
          </span>
          <textarea
            id={fieldId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            required={!approving}
            className="rounded border p-2"
            style={{
              background: 'var(--theme-bg)',
              borderColor: 'var(--theme-border)',
              color: 'var(--theme-text)',
            }}
          />
        </label>
        {error ? (
          <p role="alert" style={{ color: 'var(--theme-danger)' }}>
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border px-3 py-1 text-[11px] font-bold"
            style={{ borderColor: 'var(--theme-border)' }}
          >
            CANCEL
          </button>
          <button
            type="submit"
            disabled={blocked}
            className="rounded border px-3 py-1 text-[11px] font-bold disabled:opacity-50"
            style={{
              borderColor: approving
                ? 'var(--theme-success)'
                : 'var(--theme-danger)',
              color: approving ? 'var(--theme-success)' : 'var(--theme-danger)',
            }}
          >
            {approving ? 'CONFIRM APPROVE' : 'CONFIRM REJECT'}
          </button>
        </div>
      </form>
    </Shell>
  )
}

export function ApproveDialog(props: DialogProps) {
  return <DecisionDialog {...props} decision="approved" />
}

export function RejectDialog(props: DialogProps) {
  return <DecisionDialog {...props} decision="rejected" />
}
