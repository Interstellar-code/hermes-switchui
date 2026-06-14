import { CONFIGURABLE_TOOLSETS, DESTRUCTIVE_TOOLSETS, TOOLSET_GROUPS } from '@/lib/toolsets'
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

  function enableAll() {
    onChange({ disabled_toolsets: [] })
  }

  function disableAll() {
    onChange({ disabled_toolsets: CONFIGURABLE_TOOLSETS.map((t) => t.key) })
  }

  return (
    <div>
      <div className="wiz-toolset-header">
        <div>
          <h3>Toolsets</h3>
          <p className="lead">
            Choose which tool groups this agent can use. All toolsets are enabled by default —
            deselect to restrict access.
          </p>
        </div>
        <div className="wiz-toolset-meta">
          <span className="wiz-hint">{enabledCount} of {total} enabled</span>
          <div className="wiz-toolset-actions">
            <button type="button" className="wiz-toolset-btn" onClick={enableAll}>
              Enable all
            </button>
            <span className="wiz-toolset-btn-sep">·</span>
            <button type="button" className="wiz-toolset-btn" onClick={disableAll}>
              Disable all
            </button>
          </div>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="wiz-errors">
          {errors.map((e) => (
            <div key={e} className="wiz-error">
              {e}
            </div>
          ))}
        </div>
      )}

      {TOOLSET_GROUPS.map((group) => {
        const groupToolsets = CONFIGURABLE_TOOLSETS.filter((t) => t.group === group)
        if (groupToolsets.length === 0) return null
        return (
          <div key={group} className="wiz-toolset-group">
            <div className="wiz-toolset-group-label">{group}</div>
            <div className="skill-grid">
              {groupToolsets.map(({ key, label }) => {
                const enabled = !disabledSet.has(key)
                const destructive = DESTRUCTIVE_TOOLSETS.has(key)
                return (
                  <div
                    key={key}
                    className={`skill${enabled ? ' on' : ''}${destructive ? ' skill-destructive' : ''}`}
                    onClick={() => toggle(key)}
                    role="checkbox"
                    aria-checked={enabled}
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(key) } }}
                  >
                    <div className="chk" />
                    <span className="skill-label">{label}</span>
                    {destructive && (
                      <span className="wiz-toolset-warn-pill" title="Grants powerful system access — disable for read-only or review agents">
                        ⚠
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
