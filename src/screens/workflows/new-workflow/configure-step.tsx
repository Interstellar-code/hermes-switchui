/**
 * CONFIGURE (board 24): node list + per-node form (the graph editor's
 * NodeConfigPanel) + live read-only YAML mirror + engine validation list
 * with one-click fixes. Every edit is a lossless yaml-model document edit of
 * the wizard's single yaml draft, so unknown keys and comments survive.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { LineCounter, isMap, isScalar, isSeq, parseDocument } from 'yaml'
import { nodeColor } from '../node-colors'
import { NodeConfigPanel } from '../graph-editor/node-config-panel'
import {
  addDependency,
  declareInput,
  duplicateNode,
  getYamlParseError,
  readGraph,
  removeDependency,
  removeNodes,
  renameNode,
  setNodeBody,
  setNodePhase,
  setNodeRetry,
  setNodeTimeout,
  setNodeTrigger,
  setNodeType,
} from '../graph-editor/yaml-model'
import type { WizardIssueState } from './use-wizard-validation'
import type { WorkflowValidationIssue } from '../api-client'
import { writeTextToClipboard } from '@/lib/clipboard'
import '@/styles/graph-editor.css'

export interface ConfigureStepProps {
  yaml: string
  onChange: (yaml: string) => void
  issues: WizardIssueState
  workflowId: string
}

/** 1-based line span of each node map, plus the declared-input count. */
function outline(yaml: string): {
  nodeLines: Map<string, [number, number]>
  inputs: number
} {
  const nodeLines = new Map<string, [number, number]>()
  const lineCounter = new LineCounter()
  const doc = parseDocument(yaml, { lineCounter })
  if (doc.errors.length > 0 || !isMap(doc.contents))
    return { nodeLines, inputs: 0 }
  const nodes = doc.contents.get('nodes', true)
  if (isSeq(nodes)) {
    for (const item of nodes.items) {
      if (!isMap(item) || !item.range) continue
      const id = item.get('id', true)
      if (!isScalar(id) || typeof id.value !== 'string') continue
      // range[1] is the end of the node's own value (before trailing blank lines)
      const end = Math.max(item.range[0], item.range[1] - 1)
      nodeLines.set(id.value, [
        lineCounter.linePos(item.range[0]).line,
        lineCounter.linePos(end).line,
      ])
    }
  }
  const inputs = doc.contents.get('inputs', true)
  return { nodeLines, inputs: isSeq(inputs) ? inputs.items.length : 0 }
}

/** One-click fix for an engine issue, as a yaml-model edit (null: none). */
export function fixFor(
  issue: WorkflowValidationIssue,
): { label: string; apply: (yaml: string) => string } | null {
  if (issue.code === 'undeclared_input') {
    const name = /undeclared input '([^']+)'/.exec(issue.message)?.[1]
    if (!name) return null
    return {
      label: `Declare input ${name}`,
      apply: (y) => declareInput(y, name),
    }
  }
  if (issue.code === 'unknown_dependency' && issue.node_id) {
    const dep = /unknown node '([^']+)'/.exec(issue.message)?.[1]
    const nodeId = issue.node_id
    if (!dep) return null
    return {
      label: `Remove dep ${dep}`,
      apply: (y) => removeDependency(y, nodeId, dep),
    }
  }
  return null
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function ConfigureStep({
  yaml,
  onChange,
  issues,
  workflowId,
}: ConfigureStepProps) {
  const graph = useMemo(() => readGraph(yaml), [yaml])
  const parseError = useMemo(() => getYamlParseError(yaml), [yaml])
  const { nodeLines, inputs } = useMemo(() => outline(yaml), [yaml])
  const nodes = graph?.nodes ?? []

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = nodes.find((n) => n.id === selectedId) ?? nodes.at(0)
  const [renameError, setRenameError] = useState<string | null>(null)

  const errors = issues.kind === 'ready' ? issues.errors : []
  const warnings = issues.kind === 'ready' ? issues.warnings : []
  const countFor = (list: Array<WorkflowValidationIssue>, id: string) =>
    list.filter((i) => i.node_id === id).length

  /** Apply a yaml-model edit; an edit that cannot apply leaves the draft. */
  function apply(edit: (y: string) => string) {
    try {
      onChange(edit(yaml))
    } catch {
      // e.g. a duplicate dependency — nothing to change
    }
  }

  // Mirror line classes: selected node, then warnings, then errors on top.
  const lines = yaml.replace(/\n$/, '').split('\n')
  const lineClass = new Map<number, string>()
  const span = selected ? nodeLines.get(selected.id) : undefined
  if (span) for (let l = span[0]; l <= span[1]; l++) lineClass.set(l, 'hi')
  for (const w of warnings) if (w.line != null) lineClass.set(w.line, 'wn')
  for (const e of errors) if (e.line != null) lineClass.set(e.line, 'bad')

  const mirrorRef = useRef<HTMLDivElement>(null)
  const spanStart = span?.[0]
  useEffect(() => {
    if (spanStart == null) return
    const row = mirrorRef.current?.querySelector(`[data-line="${spanStart}"]`)
    if (row && typeof row.scrollIntoView === 'function')
      row.scrollIntoView({ block: 'nearest' })
  }, [spanStart])

  return (
    <div className="wz2-cfg">
      <nav className="wz2-cfg-nl" aria-label="Workflow outline">
        <div className="wz2-cfg-sec">
          <span className="wz2-lbl">WORKFLOW</span>
        </div>
        <div className="wz2-cfg-wf">
          {workflowId || 'no id yet'} · {graph?.name || 'unnamed'} · inputs (
          {inputs})
        </div>
        <div className="wz2-cfg-sec">
          <span className="wz2-lbl">NODES · {nodes.length}</span>
        </div>
        <ul className="wz2-cfg-nodes">
          {nodes.map((n) => {
            const ne = countFor(errors, n.id)
            const nw = countFor(warnings, n.id)
            return (
              <li key={n.id}>
                <button
                  type="button"
                  className={`wz2-cfg-ni${n.id === selected?.id ? ' on' : ''}`}
                  style={{ borderLeftColor: nodeColor(n.type) }}
                  aria-current={n.id === selected?.id ? 'true' : undefined}
                  onClick={() => {
                    setSelectedId(n.id)
                    setRenameError(null)
                  }}
                >
                  <span className="wz2-cfg-nid">{n.id}</span>
                  {issues.kind === 'ready' && (
                    <span
                      className={`wz2-cfg-st ${ne ? 'er' : nw ? 'wa' : 'ok'}`}
                      aria-label={
                        ne
                          ? plural(ne, 'error')
                          : nw
                            ? plural(nw, 'warning')
                            : 'valid'
                      }
                    >
                      {ne ? ne : nw ? '!' : '✓'}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="wz2-cfg-sec">
          <span className="wz2-lbl">VALIDATION</span>
        </div>
        <div className="wz2-cfg-ck" role="status" aria-label="Validation">
          {issues.kind === 'pending' && <div>Validating…</div>}
          {issues.kind === 'unavailable' && (
            <div className="mu">
              Validation unavailable ({issues.reason}). Checks run again on
              Review.
            </div>
          )}
          {issues.kind === 'ready' &&
            [
              ...errors.map((i) => ({ i, sev: 'er' as const })),
              ...warnings.map((i) => ({ i, sev: 'wa' as const })),
            ].map(({ i, sev }, k) => {
              const fix = sev === 'er' ? fixFor(i) : null
              return (
                <div key={k} className={sev}>
                  <button
                    type="button"
                    className="wz2-cfg-issue"
                    disabled={!i.node_id}
                    onClick={() => i.node_id && setSelectedId(i.node_id)}
                  >
                    {sev === 'er' ? '✗' : '!'}{' '}
                    {i.line != null ? `L${i.line} · ` : ''}
                    {i.message}
                  </button>
                  {fix && (
                    <button
                      type="button"
                      className="wz2-cfg-fix"
                      onClick={() => apply(fix.apply)}
                    >
                      {fix.label}
                    </button>
                  )}
                </div>
              )
            })}
          {issues.kind === 'ready' &&
            errors.length === 0 &&
            warnings.length === 0 && (
              <div className="ok">✓ YAML parses · no issues</div>
            )}
        </div>
      </nav>

      <div className="wz2-cfg-frm">
        {selected ? (
          <NodeConfigPanel
            key={selected.id}
            node={selected}
            nodes={nodes}
            renameError={renameError}
            onRename={(next) => {
              try {
                onChange(renameNode(yaml, selected.id, next))
                setSelectedId(next.trim())
                setRenameError(null)
              } catch (e) {
                setRenameError(e instanceof Error ? e.message : 'Rename failed')
              }
            }}
            onTypeChange={(type) =>
              apply((y) => setNodeType(y, selected.id, type))
            }
            onPhaseChange={(phase) =>
              apply((y) => setNodePhase(y, selected.id, phase))
            }
            onBodyChange={(body) =>
              apply((y) => setNodeBody(y, selected.id, body))
            }
            onAddDependency={(depId) =>
              apply((y) => addDependency(y, selected.id, depId))
            }
            onRemoveDependency={(depId) =>
              apply((y) => removeDependency(y, selected.id, depId))
            }
            onTriggerChange={(rule) =>
              apply((y) => setNodeTrigger(y, selected.id, rule))
            }
            onRetryChange={(n) => apply((y) => setNodeRetry(y, selected.id, n))}
            onTimeoutChange={(s) =>
              apply((y) => setNodeTimeout(y, selected.id, s))
            }
            onDelete={() => apply((y) => removeNodes(y, [selected.id]))}
            onDuplicate={() =>
              apply((y) => {
                const result = duplicateNode(y, selected.id)
                setSelectedId(result.newId)
                return result.yaml
              })
            }
          />
        ) : (
          <p className="wz2-cfg-empty" role="status">
            {parseError
              ? `YAML parse error: ${parseError} — fix it on Review or go back to Source.`
              : 'No nodes yet — add one on the Design canvas.'}
          </p>
        )}
      </div>

      <section className="wz2-cfg-ym" aria-label="YAML mirror, read-only">
        <div className="wz2-cfg-yh">
          <span className="wz2-lbl">YAML</span>
          <span className="wz2-chip ok">LIVE</span>
          <span className="wz2-cfg-mu">read-only · follows the form</span>
          <span className="wfl-grow" />
          <button
            type="button"
            className="wfw-btn wfw-btn--secondary wz2-sm"
            onClick={() => void writeTextToClipboard(yaml)}
          >
            COPY
          </button>
        </div>
        <div className="wz2-cfg-yb" ref={mirrorRef} data-testid="yaml-mirror">
          {lines.map((text, i) => (
            <div
              key={i}
              data-line={i + 1}
              className={`wz2-yl ${lineClass.get(i + 1) ?? ''}`}
            >
              <span>{i + 1}</span>
              <span>{text}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
