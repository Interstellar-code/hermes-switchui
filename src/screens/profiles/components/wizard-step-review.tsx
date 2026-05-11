import type { NewAgentDraft, WizardStep } from '../types'

type Props = {
  draft: NewAgentDraft
  errors: string[]
  submitError: string | null
  onJumpTo: (step: WizardStep) => void
}

function ReviewBlock({
  title,
  step,
  onEdit,
  children,
}: {
  title: string
  step: WizardStep
  onEdit: (s: WizardStep) => void
  children: React.ReactNode
}) {
  return (
    <div className="review-block">
      <h4>
        {title}
        <button
          type="button"
          className="wiz-btn-ghost"
          style={{ marginLeft: 'auto', fontSize: 9.5 }}
          onClick={() => onEdit(step)}
        >
          Edit
        </button>
      </h4>
      {children}
    </div>
  )
}

function ReviewRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="review-row">
      <div className="k">{k}</div>
      <div className="v">{v || <span className="muted">—</span>}</div>
    </div>
  )
}

export function WizardStepReview({ draft, errors, submitError, onJumpTo }: Props) {
  const mcpNames = Object.keys(draft.mcp_servers)

  return (
    <div>
      <h3>Review</h3>
      <p className="lead">
        Confirm the details below. Click <strong>Create</strong> to provision the agent.
        You can edit any section before creating.
      </p>

      {(errors.length > 0 || submitError) && (
        <div className="wiz-errors" style={{ marginBottom: 18 }}>
          {errors.map((e) => <div key={e} className="wiz-error">{e}</div>)}
          {submitError && <div className="wiz-error">{submitError}</div>}
        </div>
      )}

      <div className="review-grid">
        {/* Identity */}
        <ReviewBlock title="Identity" step={1} onEdit={onJumpTo}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div className="pf-glyph" style={{ width: 40, height: 40 }}>{draft.glyph || '?'}</div>
            <div>
              <div style={{ fontWeight: 600, fontFamily: 'var(--m-font-mono)', fontSize: 13 }}>{draft.name || '—'}</div>
              <div style={{ fontSize: 10.5, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.14em', marginTop: 2 }}>{draft.role || '—'}</div>
            </div>
          </div>
          {draft.tags.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {draft.tags.map((t) => <span key={t} className="pf-tag">{t}</span>)}
            </div>
          )}
        </ReviewBlock>

        {/* Persona */}
        <ReviewBlock title="Persona" step={2} onEdit={onJumpTo}>
          <ReviewRow k="Persona ID" v={draft.persona_id ?? <span className="muted">none</span>} />
          {draft.system_prompt && (
            <div className="review-prompt">{draft.system_prompt.slice(0, 300)}{draft.system_prompt.length > 300 ? '…' : ''}</div>
          )}
        </ReviewBlock>

        {/* Model */}
        <ReviewBlock title="Model" step={3} onEdit={onJumpTo}>
          <ReviewRow k="Model" v={draft.model} />
          <ReviewRow k="Provider" v={draft.provider} />
          <ReviewRow k="Max Turns" v={draft.max_turns} />
          <ReviewRow k="Reasoning" v={draft.reasoning_effort} />
        </ReviewBlock>

        {/* Skills */}
        <ReviewBlock title="Skills" step={4} onEdit={onJumpTo}>
          {draft.skill_dirs.length === 0 ? (
            <div className="review-row"><div className="v muted">No additional directories</div></div>
          ) : (
            draft.skill_dirs.map((d) => (
              <div key={d} className="review-row">
                <div className="k">Dir</div>
                <div className="v" style={{ wordBreak: 'break-all' }}>{d}</div>
              </div>
            ))
          )}
        </ReviewBlock>

        {/* MCP */}
        <ReviewBlock title="MCP Servers" step={5} onEdit={onJumpTo}>
          {mcpNames.length === 0 ? (
            <div className="review-row"><div className="v muted">None selected</div></div>
          ) : (
            mcpNames.map((name) => (
              <div key={name} className="review-row">
                <div className="k">Server</div>
                <div className="v">{name}</div>
              </div>
            ))
          )}
        </ReviewBlock>

        {/* Memory */}
        <ReviewBlock title="Memory" step={6} onEdit={onJumpTo}>
          <ReviewRow k="Enabled" v={draft.memory_enabled ? 'Yes' : 'No'} />
          {draft.memory_enabled && <ReviewRow k="Provider" v={draft.memory_provider} />}
        </ReviewBlock>
      </div>
    </div>
  )
}
