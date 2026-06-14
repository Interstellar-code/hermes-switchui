import { CONFIGURABLE_TOOLSETS, DESTRUCTIVE_TOOLSETS } from '@/lib/toolsets'
import type { NewAgentDraft } from '../types'

type Props = {
  draft: NewAgentDraft
  errors: string[]
  onChange: (patch: Partial<NewAgentDraft>) => void
}

export function WizardStepToolset({ draft, errors, onChange }: Props) {
  const total = CONFIGURABLE_TOOLSETS.length
  const disabledSet = new Set(draft.disabled_toolsets)
  const enabledCount = total - disabledSet.size

  function toggle(key: string) {
    const next = new Set(disabledSet)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    onChange({ disabled_toolsets: Array.from(next) })
  }

  return (
    <div>
      <h3>Toolsets</h3>
      <p className="lead">
        Choose which tool groups this agent can use. All toolsets are enabled by default — deselect
        to restrict access.
      </p>
      <p className="wiz-hint">
        {enabledCount} of {total} enabled
      </p>

      {errors.length > 0 && (
        <div className="wiz-errors">
          {errors.map((e) => (
            <div key={e} className="wiz-error">
              {e}
            </div>
          ))}
        </div>
      )}

      <div className="wiz-toolset-list">
        {CONFIGURABLE_TOOLSETS.map(({ key, label }) => {
          const enabled = !disabledSet.has(key)
          const destructive = DESTRUCTIVE_TOOLSETS.has(key)
          return (
            <label key={key} className={`wiz-toolset-row${enabled ? ' on' : ''}`}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={() => toggle(key)}
              />
              <span className="wiz-toolset-label">{label}</span>
              {destructive && (
                <span className="wiz-toolset-warn" title="Grants powerful system access — disable for read-only or review agents">
                  ⚠ powerful
                </span>
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}
