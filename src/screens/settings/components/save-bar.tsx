/**
 * save-bar.tsx — Sticky footer with dirty-change count + action buttons.
 */

type SaveBarProps = {
  dirtyCount: number
  onSave: () => void
  onReset: () => void
  onExport?: () => void
  onImport?: () => void
}

function IconSave() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M3 2h7l3 3v9H3V2z" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 2v4h4V2M5 11h6" strokeLinecap="round"/>
    </svg>
  )
}

function IconReset() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M3 8a5 5 0 1 0 1.5-3.5L2 3v4h4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function IconExport() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M8 2v8M5 5l3-3 3 3M3 11v2h10v-2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function IconImport() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M8 10V2M5 7l3 3 3-3M3 11v2h10v-2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function SaveBar({ dirtyCount, onSave, onReset, onExport, onImport }: SaveBarProps) {
  const hasDirty = dirtyCount > 0

  return (
    <div className="save-bar" role="region" aria-label="Save changes">
      {hasDirty ? (
        <span className="dirty-label">
          {dirtyCount} {dirtyCount === 1 ? 'change' : 'changes'}
        </span>
      ) : (
        <span>No unsaved changes</span>
      )}

      <div className="spacer" />

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
        onClick={onReset}
        disabled={!hasDirty}
      >
        <IconReset />
        Reset
      </button>

      <button
        type="button"
        className="btn primary"
        onClick={onSave}
        disabled={!hasDirty}
      >
        <IconSave />
        Save changes
      </button>
    </div>
  )
}
