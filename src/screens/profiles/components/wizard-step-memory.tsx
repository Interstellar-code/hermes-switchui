import type { NewAgentDraft } from '../types'
import { MEMORY_PROVIDER_CATALOG } from '@/lib/memory-provider-catalog'

type Props = {
  draft: NewAgentDraft
  errors: Array<string>
  onChange: (patch: Partial<NewAgentDraft>) => void
}

export function WizardStepMemory({ draft, errors, onChange }: Props) {
  return (
    <div>
      <h3>Memory</h3>
      <p className="lead">
        Enable long-term memory so this agent can recall facts across sessions.
        Disabled by default — the agent will not retain anything between conversations.
      </p>

      {errors.length > 0 && (
        <div className="wiz-errors">
          {errors.map((e) => (
            <div key={e} className="wiz-error">{e}</div>
          ))}
        </div>
      )}

      {/* Toggle */}
      <div className="wiz-toggle-row" style={{ marginBottom: 22 }}>
        <button
          type="button"
          className={`wiz-toggle${draft.memory_enabled ? ' on' : ''}`}
          onClick={() => onChange({ memory_enabled: !draft.memory_enabled })}
          role="switch"
          aria-checked={draft.memory_enabled}
        >
          <span className="wiz-toggle-thumb" />
        </button>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, fontFamily: 'var(--m-font-mono)', color: 'var(--m-text-strong)' }}>
            {draft.memory_enabled ? 'Memory enabled' : 'Memory disabled'}
          </div>
          <div className="wiz-hint" style={{ marginTop: 2 }}>
            {draft.memory_enabled
              ? 'Agent will persist facts, decisions, and context across sessions.'
              : 'Each session starts fresh with no memory of previous conversations.'}
          </div>
        </div>
      </div>

      <div className="wiz-hint" style={{ marginBottom: 18 }}>
        Inherited from your main profile — override the provider below if needed.
      </div>

      {/* Provider selection (visible when enabled) */}
      {draft.memory_enabled && (
        <div className="field">
          <label>Provider</label>
          <div className="memory-providers">
            {MEMORY_PROVIDER_CATALOG.map((p) => (
              <div
                key={p.id}
                className={`skill${draft.memory_provider === p.id ? ' on' : ''}`}
                style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4, padding: '12px 14px' }}
                onClick={() => onChange({ memory_provider: p.id })}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <div className="chk" />
                  <span style={{ fontWeight: 600 }}>{p.label}</span>
                </div>
                <div style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.5, paddingLeft: 22 }}>{p.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
