/**
 * node-config-panel.tsx — F4 right-hand panel for the selected node: id,
 * type, stage, depends_on chips, body text, retry, timeout, trigger.
 * All mutations flow through the pure yaml-model (props are callbacks).
 */
import { useEffect, useState } from 'react'
import { PALETTE_TYPES } from './editor-graph'
import { TRIGGER_RULES } from './yaml-model'
import type { EditorNode } from './yaml-model'

const BODY_LABELS: Record<EditorNode['type'], string> = {
  prompt: 'PROMPT',
  bash: 'BASH COMMAND',
  script: 'SCRIPT',
  command: 'COMMAND',
  approval: 'APPROVAL MESSAGE',
  loop: 'LOOP PROMPT',
  cancel: 'CANCEL REASON',
  subgraph: 'SUBGRAPH REF',
  router: 'ROUTER (routes not editable here)',
}

const COMMON_PHASES = [
  'discover',
  'plan',
  'execute',
  'verify',
  'record',
  'report',
]

export interface NodeConfigPanelProps {
  node: EditorNode
  nodes: Array<EditorNode>
  renameError?: string | null
  onRename: (nextId: string) => void
  onTypeChange: (type: EditorNode['type']) => void
  onPhaseChange: (phase: string | null) => void
  onBodyChange: (body: string) => void
  onAddDependency: (depId: string) => void
  onRemoveDependency: (depId: string) => void
  onTriggerChange: (rule: string | null) => void
  onRetryChange: (maxAttempts: number | null) => void
  onTimeoutChange: (seconds: number | null) => void
  onDelete: () => void
  onDuplicate: () => void
}

export function NodeConfigPanel({
  node,
  nodes,
  renameError,
  onRename,
  onTypeChange,
  onPhaseChange,
  onBodyChange,
  onAddDependency,
  onRemoveDependency,
  onTriggerChange,
  onRetryChange,
  onTimeoutChange,
  onDelete,
  onDuplicate,
}: NodeConfigPanelProps) {
  const [idDraft, setIdDraft] = useState(node.id)
  useEffect(() => setIdDraft(node.id), [node.id])

  const candidates = nodes.filter(
    (n) => n.id !== node.id && !node.dependsOn.includes(n.id),
  )
  const phaseOptions = [
    ...new Set([...COMMON_PHASES, ...(node.phase ? [node.phase] : [])]),
  ]

  function commitRename() {
    const next = idDraft.trim()
    if (!next || next === node.id) {
      setIdDraft(node.id)
      return
    }
    onRename(next)
  }

  return (
    <aside className="wge-cfg" aria-label={`Selected node ${node.id}`}>
      <h2>
        SELECTED NODE · <span className="wge-cfg-id">{node.id}</span>
      </h2>
      <div className="wge-f2">
        <div className="wge-f">
          <label htmlFor="wge-nid">ID</label>
          <input
            id="wge-nid"
            value={idDraft}
            spellCheck={false}
            onChange={(e) => setIdDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
            }}
          />
        </div>
        <div className="wge-f">
          <label htmlFor="wge-nty">TYPE</label>
          <select
            id="wge-nty"
            value={node.type}
            onChange={(e) => onTypeChange(e.target.value as EditorNode['type'])}
          >
            {PALETTE_TYPES.map(({ type, label }) => (
              <option key={type} value={type}>
                {label.toLowerCase()}
              </option>
            ))}
          </select>
        </div>
      </div>
      {renameError && (
        <p className="wge-cfg-err" role="alert">
          {renameError}
        </p>
      )}
      <div className="wge-f2">
        <div className="wge-f">
          <label htmlFor="wge-nph">STAGE</label>
          <input
            id="wge-nph"
            list="wge-phases"
            value={node.phase ?? ''}
            placeholder="auto"
            spellCheck={false}
            onChange={(e) =>
              onPhaseChange(e.target.value === '' ? null : e.target.value)
            }
          />
          <datalist id="wge-phases">
            {phaseOptions.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        {(node.type === 'bash' || node.type === 'script') && (
          <div className="wge-f">
            <label htmlFor="wge-nto">TIMEOUT (MS)</label>
            <input
              id="wge-nto"
              type="number"
              min={1}
              value={node.timeout ?? ''}
              placeholder="none"
              onChange={(e) =>
                onTimeoutChange(
                  e.target.value === '' ? null : Number(e.target.value),
                )
              }
            />
          </div>
        )}
      </div>
      <div className="wge-f">
        <label>RUNS AFTER</label>
        <div className="wge-dep">
          {node.dependsOn.map((dep) => (
            <span key={dep} className="wge-dep-chip">
              {dep}
              <button
                type="button"
                aria-label={`Remove dependency on ${dep}`}
                onClick={() => onRemoveDependency(dep)}
              >
                ×
              </button>
            </span>
          ))}
          {candidates.length > 0 ? (
            <select
              className="wge-dep-add"
              aria-label="Add dependency"
              value=""
              onChange={(e) => {
                if (e.target.value) onAddDependency(e.target.value)
              }}
            >
              <option value="">+ ADD</option>
              {candidates.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.id}
                </option>
              ))}
            </select>
          ) : (
            <span className="wge-meta">no other nodes</span>
          )}
        </div>
      </div>
      <div className="wge-f">
        <label htmlFor="wge-ncmd">{BODY_LABELS[node.type]}</label>
        <textarea
          id="wge-ncmd"
          value={node.body}
          spellCheck={false}
          readOnly={node.type === 'router'}
          onChange={(e) => onBodyChange(e.target.value)}
        />
      </div>
      <div className="wge-f2">
        <div className="wge-f">
          <label htmlFor="wge-nrt">RETRY</label>
          <select
            id="wge-nrt"
            value={node.retryAttempts ?? ''}
            onChange={(e) =>
              onRetryChange(
                e.target.value === '' ? null : Number(e.target.value),
              )
            }
          >
            <option value="">none</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}× on transient errors
              </option>
            ))}
          </select>
        </div>
        <div className="wge-f">
          <label htmlFor="wge-ntr">TRIGGER</label>
          <select
            id="wge-ntr"
            value={node.triggerRule ?? ''}
            onChange={(e) => onTriggerChange(e.target.value || null)}
          >
            <option value="">all_success (default)</option>
            {TRIGGER_RULES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="wge-ft">
        <button
          type="button"
          className="wge-btn wge-btn-red"
          onClick={onDelete}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9" />
          </svg>
          DELETE NODE
        </button>
        <span className="wge-grow" />
        <button
          type="button"
          className="wge-btn wge-btn-gh"
          onClick={onDuplicate}
        >
          DUPLICATE
        </button>
      </div>
    </aside>
  )
}
