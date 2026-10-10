/**
 * save-bar.tsx — Sticky footer with dirty-change count + action buttons.
 *
 * Every prop beyond the original four is optional and defaults to the previous
 * behaviour, so callers that know nothing about section ownership or save
 * phase render exactly as before.
 */

import { useState } from 'react'
import { SaveReviewDialog } from './save-review-dialog'
import type { SectionOwnership } from '../lib/section-registry'
import type { SaveState } from '@/stores/settings-store'
import { gatewayRestart } from '@/lib/hermes-client'
import { useSettingsStore } from '@/stores/settings-store'

type SaveBarProps = {
  dirtyCount: number
  onSave: () => void
  onRefresh: () => void
  onExport?: () => void
  onImport?: () => void
  /** Ownership of the section currently on screen, for honest idle copy. */
  activeOwnership?: SectionOwnership
  /** Save phase + failures from the settings store. */
  saveState?: SaveState
  /** Revert every unsaved edit. Button is hidden when omitted. */
  onDiscardAll?: () => void
}

/**
 * What the bar says when there is nothing dirty. A section whose controls
 * write the gateway directly must not claim the save button applies to it.
 */
function idleLabel(ownership: SectionOwnership | undefined): string {
  switch (ownership) {
    case 'self-saving':
      return 'This section saves its own changes'
    case 'mixed':
      return 'No unsaved changes · some cards save immediately'
    case 'read-only':
      return 'Nothing to save in this section'
    default:
      return 'No unsaved changes'
  }
}

function IconSave() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden
    >
      <path
        d="M3 2h7l3 3v9H3V2z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6 2v4h4V2M5 11h6" strokeLinecap="round" />
    </svg>
  )
}

function IconRefresh() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden
    >
      <path
        d="M3 8a5 5 0 1 0 1.5-3.5L2 3v4h4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconExport() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden
    >
      <path
        d="M8 2v8M5 5l3-3 3 3M3 11v2h10v-2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconImport() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden
    >
      <path
        d="M8 10V2M5 7l3 3 3-3M3 11v2h10v-2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SaveBar({
  dirtyCount,
  onSave,
  onRefresh,
  onExport,
  onImport,
  activeOwnership,
  saveState,
  onDiscardAll,
}: SaveBarProps) {
  const hasDirty = dirtyCount > 0
  const phase = saveState?.phase ?? 'idle'
  const isSaving = phase === 'saving'
  const [reviewing, setReviewing] = useState(false)

  /**
   * Run the screen's existing save, then restart the gateway only if the save
   * finished with no failures. `onSave` is fire-and-forget, so the outcome is
   * read from the store's save phase (set to 'saving' synchronously by `save`).
   */
  function confirmSave(restart: boolean) {
    setReviewing(false)
    onSave()
    if (!restart) return
    const unsub = useSettingsStore.subscribe((state) => {
      const { phase: p, failures } = state.saveState
      if (p === 'saving') return
      unsub()
      if (p === 'success' && failures.length === 0)
        void gatewayRestart().catch(() => {})
    })
    if (useSettingsStore.getState().saveState.phase !== 'saving') unsub()
  }

  return (
    <div className="save-bar" role="region" aria-label="Save changes">
      <span aria-live="polite">
        {phase === 'error' && saveState?.error ? (
          <span className="warn">{saveState.error}</span>
        ) : hasDirty ? (
          <span className="dirty-label">
            {dirtyCount} {dirtyCount === 1 ? 'change' : 'changes'}
          </span>
        ) : (
          idleLabel(activeOwnership)
        )}
      </span>

      <div className="spacer" />

      {onDiscardAll && hasDirty && (
        <button
          type="button"
          className="btn"
          onClick={onDiscardAll}
          disabled={isSaving}
        >
          Discard all
        </button>
      )}

      {onImport && (
        <button type="button" className="btn" onClick={onImport}>
          <IconImport />
          Import
        </button>
      )}

      {onExport && (
        <button type="button" className="btn" onClick={onExport}>
          <IconExport />
          Export
        </button>
      )}

      <div className="sep" />

      <button
        type="button"
        className="btn"
        onClick={onRefresh}
        title="Reload config from disk"
      >
        <IconRefresh />
        Refresh
      </button>

      <button
        type="button"
        className="btn primary"
        onClick={() => setReviewing(true)}
        disabled={isSaving || !hasDirty}
      >
        <IconSave />
        {isSaving ? 'Saving…' : 'Save changes'}
      </button>

      {reviewing && (
        <SaveReviewDialog
          open
          onCancel={() => setReviewing(false)}
          onConfirm={confirmSave}
        />
      )}
    </div>
  )
}
