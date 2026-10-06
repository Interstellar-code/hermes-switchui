/** REVIEW & SAVE step: read-only graph, stats, checks, save target. */
import { useMemo } from 'react'
import { buildChecks } from './checks'
import { DraftGraphPreview } from './graph-preview'
import { IdField } from './id-field'
import { suggestFreeIds, yamlToParsedWorkflow } from './yaml-lint'
import type { IdStatus, WizardValidation } from './use-wizard-validation'

export interface SaveFailure {
  kind: 'conflict' | 'engine' | 'other'
  message: string
}

interface ReviewStepProps {
  yaml: string
  id: string
  name: string
  description: string
  source: 'user' | 'project'
  openAfter: boolean
  validation: WizardValidation
  idStatus: IdStatus
  takenIds: ReadonlySet<string>
  ack: boolean
  failure: SaveFailure | null
  saving: boolean
  onId: (v: string) => void
  onName: (v: string) => void
  onDescription: (v: string) => void
  onSource: (v: 'user' | 'project') => void
  onOpenAfter: (v: boolean) => void
  onAck: (v: boolean) => void
  onYaml: (v: string) => void
}

const GLYPH = { pass: '✓', fail: '✗', warn: '!', pending: '…' } as const

export function ReviewStep(p: ReviewStepProps) {
  const parsed = useMemo(() => yamlToParsedWorkflow(p.yaml), [p.yaml])
  const checks = useMemo(
    () => buildChecks(p.validation, p.id, p.idStatus),
    [p.validation, p.id, p.idStatus],
  )
  const types = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of parsed?.nodes ?? [])
      m.set(n.type ?? 'prompt', (m.get(n.type ?? 'prompt') ?? 0) + 1)
    return [...m].map(([t, n]) => `${n} ${t}`).join(' · ')
  }, [parsed])
  const approvals = (parsed?.nodes ?? []).filter(
    (n) => n.type === 'approval',
  ).length
  const lineCount = p.yaml
    .split('\n')
    .filter((l, i, a) => l || i < a.length - 1).length
  const pending = p.validation.hasValidate && p.validation.serverPending
  const showSkeleton =
    pending && !p.validation.server && checks.rows.length === 0

  return (
    <div className="wz2-review">
      <section className="wz2-lp" aria-label="Summary">
        <div className="wz2-fields">
          <div className="wz2-field">
            <label className="wfl-label" htmlFor="wz2-name">
              Name
            </label>
            <input
              id="wz2-name"
              className="wfl-input"
              value={p.name}
              onChange={(e) => p.onName(e.target.value)}
              placeholder="My Workflow"
            />
          </div>
          <div className="wz2-field">
            <label className="wfl-label" htmlFor="wz2-desc">
              Description
            </label>
            <input
              id="wz2-desc"
              className="wfl-input"
              value={p.description}
              onChange={(e) => p.onDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
        </div>
        <DraftGraphPreview yaml={p.yaml} label={p.id || 'draft'} />
        <div className="wz2-stats">
          <div className="wz2-stt">
            <span className="wfl-label">Nodes</span>
            <b>{parsed?.node_count ?? 0}</b>
            <span className="wfl-meta">{types || '—'}</span>
          </div>
          <div className="wz2-stt">
            <span className="wfl-label">Inputs</span>
            <b>{parsed?.optional_inputs.length ?? 0}</b>
            <span className="wfl-meta">
              {(parsed?.optional_inputs ?? []).join(', ') || 'none declared'}
            </span>
          </div>
          <div className="wz2-stt">
            <span className="wfl-label">Pauses</span>
            <b>{approvals}</b>
            <span className="wfl-meta">
              {approvals
                ? 'approval nodes wait for you'
                : 'runs straight through'}
            </span>
          </div>
        </div>
        <details className="wz2-yaml-d">
          <summary>View YAML · {lineCount} lines</summary>
          <textarea
            className="wfl-input wz2-yaml"
            aria-label="Workflow YAML"
            spellCheck={false}
            value={p.yaml}
            onChange={(e) => p.onYaml(e.target.value)}
          />
        </details>
        <span className="wfl-meta">
          Running is Conductor’s job. Saving here only writes a definition.
        </span>
      </section>
      <aside className="wz2-rp" aria-label="Checks and save">
        {p.failure?.kind === 'conflict' && (
          <div className="wz2-ban er" role="alert">
            <b>
              {p.id} already exists in {p.source}.
            </b>{' '}
            Nothing was overwritten. Pick a new id, or save to the other scope.
            Edits to an existing definition go through the Workflows editor.
          </div>
        )}
        {p.failure?.kind === 'engine' && (
          <div className="wz2-ban er" role="alert">
            <b>Workflow engine unavailable.</b> Nothing was saved. Check that
            the engine is running, then try again.
          </div>
        )}
        {p.failure?.kind === 'other' && (
          <div className="wz2-ban er" role="alert">
            <b>Not saved.</b> {p.failure.message}
          </div>
        )}
        <IdField
          inputId="wz2-id-review"
          label="Workflow id"
          value={p.id}
          onChange={p.onId}
          status={p.idStatus}
          suggestions={suggestFreeIds(p.id, p.takenIds)}
        />
        <span className="wfl-label">
          Checks · {p.validation.hasValidate ? 'server validate' : 'local'}
        </span>
        {showSkeleton ? (
          <div className="wfl-skeletons" aria-label="Loading checks">
            <div className="wfl-skeleton" style={{ width: '80%' }} />
            <div className="wfl-skeleton" style={{ width: '60%' }} />
            <div className="wfl-skeleton" style={{ width: '70%' }} />
          </div>
        ) : (
          <ul className="wz2-ck" aria-label="Checks">
            {checks.rows.map((r) => (
              <li key={r.key} className={`is-${r.state}`}>
                <span className="wz2-g" aria-hidden="true">
                  {GLYPH[r.state]}
                </span>
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        )}
        {p.validation.risky.length > 0 && (
          <div className="wz2-risk" role="alert">
            {p.validation.risky.map((r) => (
              <div key={`${r.node_id}-${r.line}`} className="wz2-risk-i">
                <b>
                  ! Risky shell · {r.node_id}, line {r.line}
                </b>
                <span className="wfl-desc">
                  {r.reason} <code>{r.snippet}</code>. Runs with this profile’s
                  tools and env.
                </span>
              </div>
            ))}
            <label className="wz2-cb">
              <input
                type="checkbox"
                checked={p.ack}
                onChange={(e) => p.onAck(e.target.checked)}
              />
              I reviewed this command
            </label>
          </div>
        )}
        <fieldset className="wz2-tg">
          <legend className="wfl-label">Save to</legend>
          {(
            [
              [
                'project',
                'Project',
                'shared with the repo',
                '.hermes/workflows',
              ],
              ['user', 'User', 'only you', '~/.hermes/workflows'],
            ] as const
          ).map(([v, t, who, dir]) => (
            <label
              key={v}
              className={`wz2-ro${p.source === v ? ' is-sel' : ''}`}
            >
              <input
                type="radio"
                name="wz2-target"
                checked={p.source === v}
                onChange={() => p.onSource(v)}
              />
              <span>
                <b>{t}</b> · {who}
                <br />
                <span className="wfl-meta">
                  {dir}/{p.id || '<id>'}.yaml
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="wz2-cb">
          <input
            type="checkbox"
            checked={p.openAfter}
            onChange={(e) => p.onOpenAfter(e.target.checked)}
          />
          Open in Workflows after save
        </label>
        {p.saving && <span className="wfl-meta">Saving…</span>}
      </aside>
    </div>
  )
}
