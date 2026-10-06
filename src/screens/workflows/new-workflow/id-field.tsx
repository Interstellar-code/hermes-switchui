import type { IdStatus } from './use-wizard-validation'

const CHIP: Record<IdStatus, { cls: string; text: string } | null> = {
  empty: null,
  invalid: { cls: 'er', text: 'INVALID ID' },
  checking: { cls: 'mu', text: 'CHECKING…' },
  available: { cls: 'ok', text: 'AVAILABLE' },
  taken: { cls: 'er', text: 'ID TAKEN' },
  unknown: { cls: 'mu', text: 'NOT CHECKED' },
}

interface Props {
  inputId: string
  label?: string
  value: string
  status: IdStatus
  onChange: (v: string) => void
  /** Free ids offered when the current one is taken. */
  suggestions?: Array<string>
  note?: string
}

/** Workflow id input with live availability status. */
export function IdField({
  inputId,
  label = 'New workflow id',
  value,
  status,
  onChange,
  suggestions = [],
  note,
}: Props) {
  const chip = CHIP[status]
  const bad = status === 'taken' || status === 'invalid'
  return (
    <div className="wz2-idf">
      <div className="wz2-idf-row">
        <div className="wz2-idf-in">
          <label className="wfl-label" htmlFor={inputId}>
            {label}
          </label>
          <input
            id={inputId}
            className={`wfl-input${bad ? ' is-bad' : ''}`}
            value={value}
            aria-invalid={bad}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
            placeholder="my-workflow"
          />
        </div>
        {chip && (
          <span className={`wz2-chip ${chip.cls}`} role="status">
            {chip.text}
          </span>
        )}
        {note && <span className="wfl-meta">{note}</span>}
      </div>
      {status === 'invalid' && (
        <span className="wfl-warn">
          id must be 1–128 chars of [A-Za-z0-9_:.-]
        </span>
      )}
      {status === 'taken' && suggestions.length > 0 && (
        <div className="wz2-sug">
          <span className="wfl-meta">Free ids:</span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="wfw-btn wfw-btn--secondary wz2-sm"
              onClick={() => onChange(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
