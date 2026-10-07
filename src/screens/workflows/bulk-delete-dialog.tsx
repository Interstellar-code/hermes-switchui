/**
 * bulk-delete-dialog.tsx — F8 destructive bulk-action confirmation.
 *
 * Modeled on the detail page's ConfirmDialog (same portal + focus-trap +
 * pf-confirm base classes), extended with what a bulk destructive action
 * needs: every selected workflow listed by name and id in three groups
 * (Delete / Reset to factory / Can't delete), an opt-in checkbox for
 * resetting factory rows, type-to-confirm above 5 affected rows, and a
 * per-row result view that stays open on partial failure.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { executeBulkDelete, planBulkDelete } from './bulk-delete'
import type { BulkSummary } from './bulk-delete'
import type { WorkflowSummary } from './types'
import { useFocusTrap } from '@/components/ui/use-focus-trap'
import '@/screens/profiles/components/confirm-dialog.css'
import './bulk-delete-dialog.css'

/** Above this many affected rows the user must type the count to confirm. */
const TYPE_TO_CONFIRM_ABOVE = 5

interface BulkDeleteDialogProps {
  open: boolean
  selected: Array<WorkflowSummary>
  onClose: () => void
  /** Parent drops the succeeded ids from its selection. */
  onCleared: (ids: Array<string>) => void
}

function RowList({ rows }: { rows: Array<WorkflowSummary> }) {
  return (
    <ul className="wbd-list">
      {rows.map((wf) => (
        <li key={wf.id}>
          <span className="wbd-name">{wf.name}</span>
          <span className="wbd-id">{wf.id}</span>
        </li>
      ))}
    </ul>
  )
}

export function BulkDeleteDialog({
  open,
  selected,
  onClose,
  onCleared,
}: BulkDeleteDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const messageId = useId()
  const queryClient = useQueryClient()

  const [phase, setPhase] = useState<'confirm' | 'running' | 'result'>(
    'confirm',
  )
  const [resetOptIn, setResetOptIn] = useState(false)
  const [typed, setTyped] = useState('')
  const [summary, setSummary] = useState<BulkSummary | null>(null)

  // Fresh confirm view every time the dialog opens.
  useEffect(() => {
    if (open) {
      setPhase('confirm')
      setResetOptIn(false)
      setTyped('')
      setSummary(null)
    }
  }, [open])

  useFocusTrap(open, dialogRef, () => {
    if (phase !== 'running') onClose()
  })

  const plan = useMemo(
    () => planBulkDelete(selected, resetOptIn),
    [selected, resetOptIn],
  )
  const affected = plan.toDelete.length + plan.toReset.length
  const needsTyping = affected > TYPE_TO_CONFIRM_ABOVE
  const typeMatches = typed === String(affected)
  const confirmDisabled =
    phase === 'running' || affected === 0 || (needsTyping && !typeMatches)

  if (!open) return null

  async function handleConfirm() {
    if (confirmDisabled) return
    setPhase('running')
    const result = await executeBulkDelete(plan)
    setSummary(result)
    setPhase('result')
    // Definitions list refreshed exactly once per run; the parent's
    // selection only loses rows the server actually acted on.
    await queryClient.invalidateQueries({
      queryKey: ['workflow-definitions'],
    })
    onCleared(
      result.results.filter((r) => r.outcome !== 'failed').map((r) => r.id),
    )
  }

  const failedRows = summary?.results.filter((r) => r.outcome === 'failed')

  return createPortal(
    <div
      className="pf-confirm-backdrop"
      onClick={phase === 'running' ? undefined : onClose}
    >
      <div
        ref={dialogRef}
        className="pf-confirm wbd-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        {phase !== 'result' ? (
          <>
            <h3 id={titleId}>Delete workflows?</h3>
            <div id={messageId} className="wbd-body">
              <section className="wbd-group">
                <h4>
                  Delete{' '}
                  <span className="wbd-count">{plan.toDelete.length}</span>
                </h4>
                {plan.toDelete.length === 0 ? (
                  <p className="wbd-none">Nothing to delete.</p>
                ) : (
                  <RowList rows={plan.toDelete} />
                )}
              </section>

              {plan.toReset.length + plan.skipped.length > 0 && (
                <section className="wbd-group">
                  <h4>
                    Reset to factory{' '}
                    <span className="wbd-count">
                      {plan.toReset.length + plan.skipped.length}
                    </span>
                  </h4>
                  <label className="wbd-opt">
                    <input
                      type="checkbox"
                      checked={resetOptIn}
                      onChange={(e) => setResetOptIn(e.target.checked)}
                    />
                    Reset factory workflows to their defaults (skipped unless
                    checked)
                  </label>
                  <RowList rows={[...plan.toReset, ...plan.skipped]} />
                </section>
              )}

              <section className="wbd-group">
                <h4>Can&apos;t delete</h4>
                {phase === 'running' ? (
                  <p className="wbd-none">Checking each row…</p>
                ) : (
                  <p className="wbd-none">
                    None known yet — each row is checked during the run.
                  </p>
                )}
              </section>

              {needsTyping && (
                <div className="wbd-type">
                  <label htmlFor="wbd-type-input">
                    Type <b>{affected}</b> to confirm
                  </label>
                  <input
                    id="wbd-type-input"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoComplete="off"
                    inputMode="numeric"
                    placeholder={String(affected)}
                    aria-invalid={!typeMatches || undefined}
                  />
                </div>
              )}
            </div>
            <div className="pf-confirm-actions">
              <button
                type="button"
                className="btn"
                onClick={onClose}
                disabled={phase === 'running'}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void handleConfirm()}
                disabled={confirmDisabled}
                title={
                  affected === 0
                    ? 'Nothing will be deleted — factory workflows only reset when opted in'
                    : undefined
                }
              >
                {phase === 'running'
                  ? 'Deleting…'
                  : `Delete ${affected} ${affected === 1 ? 'workflow' : 'workflows'}`}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 id={titleId}>Bulk delete results</h3>
            <div id={messageId} className="wbd-body">
              <p className="wbd-summary" role="status">
                Deleted {summary?.deleted ?? 0} · Reset {summary?.reset ?? 0} ·
                Failed {summary?.failed ?? 0}
              </p>
              {(failedRows?.length ?? 0) > 0 ? (
                <section className="wbd-group">
                  <h4>Can&apos;t delete — {failedRows!.length}</h4>
                  <ul className="wbd-list wbd-failed">
                    {failedRows!.map((r) => (
                      <li key={r.id}>
                        <span className="wbd-name">{r.name}</span>
                        <span className="wbd-id">{r.id}</span>
                        <span className="wbd-msg">{r.message}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="wbd-none">
                    Failed rows stay selected; nothing was retried.
                  </p>
                </section>
              ) : (
                <p className="wbd-none">Every selected row succeeded.</p>
              )}
            </div>
            <div className="pf-confirm-actions">
              <button type="button" className="btn" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
