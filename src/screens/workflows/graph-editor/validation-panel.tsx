/**
 * validation-panel.tsx — F4 editor validation strip under the canvas:
 * debounced engine (feature `validate`) or client-lint results, clickable
 * node refs focus the node on the canvas.
 */
export interface EditorIssue {
  line: number | null
  col: number | null
  code: string
  message: string
  node_id?: string
}

export type ValidationState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | {
      phase: 'done'
      source: 'engine' | 'client'
      errors: Array<EditorIssue>
      warnings: Array<EditorIssue>
    }
  | { phase: 'error'; message: string }

export function ValidationPanel({
  state,
  onFocusNode,
}: {
  state: ValidationState
  onFocusNode: (nodeId: string) => void
}) {
  if (state.phase === 'idle') return null
  const done = state.phase === 'done' ? state : null
  const errorCount = done?.errors.length ?? 0
  const warningCount = done?.warnings.length ?? 0

  return (
    <div
      className={`wge-val${errorCount > 0 ? ' has-errors' : ''}`}
      role="status"
      aria-label="Graph validation"
    >
      {state.phase === 'loading' && (
        <div className="wge-val-h">VALIDATING…</div>
      )}
      {state.phase === 'error' && (
        <>
          <div className="wge-val-h">VALIDATION FAILED</div>
          <span>{state.message}</span>
        </>
      )}
      {done && (
        <>
          <div className="wge-val-h">
            {errorCount > 0 || warningCount > 0
              ? `${errorCount} ERROR${errorCount === 1 ? '' : 'S'} · ${warningCount} WARNING${warningCount === 1 ? '' : 'S'}`
              : '✓ VALID · no errors'}
            {done.source === 'client' && (
              <span className="wge-val-src"> · client lint</span>
            )}
          </div>
          {done.errors.map((issue, i) => (
            <IssueLine
              key={`e${i}`}
              issue={issue}
              severity="error"
              onFocusNode={onFocusNode}
            />
          ))}
          {done.warnings.map((issue, i) => (
            <IssueLine
              key={`w${i}`}
              issue={issue}
              severity="warning"
              onFocusNode={onFocusNode}
            />
          ))}
        </>
      )}
    </div>
  )
}

function IssueLine({
  issue,
  severity,
  onFocusNode,
}: {
  issue: EditorIssue
  severity: 'error' | 'warning'
  onFocusNode: (nodeId: string) => void
}) {
  const pos =
    issue.line != null
      ? ` (L${issue.line}${issue.col != null ? `:${issue.col}` : ''})`
      : ''
  return (
    <span className={`wge-val-item ${severity}`}>
      {severity === 'error' ? '✗' : '!'}{' '}
      {issue.node_id ? (
        <button
          type="button"
          className="wge-val-node"
          onClick={() => onFocusNode(issue.node_id!)}
        >
          {issue.node_id}
        </button>
      ) : null}
      {issue.message}
      {pos}
    </span>
  )
}
