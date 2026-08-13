import type { NewAgentDraft } from '../types'
import type { NormalizedToolset } from '@/lib/toolsets'
import {
  PLUGINS_GROUP,
  TOOLSET_GROUPS,
  buildStaticToolsetCatalog,
  getToolsetSecurityHint,
  isToolsetSuppressed,
} from '@/lib/toolsets'
// Same fetch + query key as the Toolsets screen, so the two share one cache
// entry instead of each holding their own copy of the catalog.
import { useToolsetCatalog } from '@/lib/toolsets-api'

type Props = {
  draft: NewAgentDraft
  errors: Array<string>
  onChange: (patch: Partial<NewAgentDraft>) => void
}

export function WizardStepToolset({ draft, errors, onChange }: Props) {
  const catalogQuery = useToolsetCatalog()

  // While loading or on error, fall back to the static catalog so the step
  // always renders. source stays 'static' until live data arrives.
  const data = catalogQuery.data
  const toolsets: Array<NormalizedToolset> =
    data?.toolsets ?? buildStaticToolsetCatalog()
  const source: 'gateway' | 'static' = data?.source ?? 'static'

  const total = toolsets.length
  const disabledSet = new Set(draft.disabled_toolsets)
  const enabledCount = total - disabledSet.size

  // Toolsets the wizard shows as selected but the live gateway is actually
  // suppressing right now (agent.disabled_toolsets applied last, always wins
  // — see isToolsetSuppressed()). Only meaningful for source: 'gateway'; the
  // static fallback has no live signal to check against.
  const suppressedKeys = new Set(
    toolsets
      .filter((t) => isToolsetSuppressed(t, source, !disabledSet.has(t.key)))
      .map((t) => t.key),
  )

  // Distinct groups present, ordered: static TOOLSET_GROUPS first, Plugins last.
  const presentGroups = new Set(toolsets.map((t) => t.group))
  const orderedGroups = [
    ...TOOLSET_GROUPS.filter((g) => presentGroups.has(g)),
    ...(presentGroups.has(PLUGINS_GROUP) ? [PLUGINS_GROUP] : []),
  ]

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
    onChange({ disabled_toolsets: toolsets.map((t) => t.key) })
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
          {source === 'gateway' && (
            <p className="wiz-hint" style={{ marginTop: 4 }}>
              Reflecting the live gateway toolset registry.
            </p>
          )}
          {suppressedKeys.size > 0 && (
            <p
              className="wiz-hint"
              style={{ marginTop: 4, color: 'var(--m-danger, var(--theme-danger, #e05))' }}
            >
              {suppressedKeys.size} selected {suppressedKeys.size === 1 ? 'toolset is' : 'toolsets are'}{' '}
              suppressed by the gateway's current config and will not actually be available —
              see the marked entries below.
            </p>
          )}
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

      {orderedGroups.map((group) => {
        const groupToolsets = toolsets.filter((t) => t.group === group)
        if (groupToolsets.length === 0) return null
        return (
          <div key={group} className="wiz-toolset-group">
            <div className="wiz-toolset-group-label">{group}</div>
            <div className="skill-grid">
              {groupToolsets.map(({ key, label, destructive, plugin }) => {
                const enabled = !disabledSet.has(key)
                const suppressed = suppressedKeys.has(key)
                const securityHint = getToolsetSecurityHint(key)
                const suppressedHint =
                  "Suppressed by the gateway's current config (agent.disabled_toolsets) — " +
                  'selected here, but will not actually be available to this agent.'
                return (
                  <div
                    key={key}
                    className={`skill${enabled ? ' on' : ''}${destructive ? ' skill-destructive' : ''}${suppressed ? ' skill-suppressed' : ''}`}
                    style={
                      suppressed
                        ? { outline: '1px dashed var(--m-danger, var(--theme-danger, #e05))', outlineOffset: '-1px' }
                        : undefined
                    }
                    title={suppressed ? suppressedHint : (securityHint ?? undefined)}
                    onClick={() => toggle(key)}
                    role="checkbox"
                    aria-checked={enabled}
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(key) } }}
                  >
                    <div className="chk" />
                    <span className="skill-label">{label}</span>
                    {plugin && (
                      <span className="wiz-toolset-plugin-pill" title="Registered by a Hermes plugin">
                        🔌
                      </span>
                    )}
                    {destructive && (
                      <span className="wiz-toolset-warn-pill" title={securityHint ?? 'Grants powerful system access — disable for read-only or review agents'}>
                        ⚠
                      </span>
                    )}
                    {suppressed && (
                      <span
                        className="wiz-toolset-suppressed-pill"
                        title={suppressedHint}
                        style={{ color: 'var(--m-danger, var(--theme-danger, #e05))' }}
                      >
                        ⛔ suppressed
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
