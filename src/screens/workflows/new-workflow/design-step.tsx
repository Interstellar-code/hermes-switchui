/**
 * DESIGN (board 23): the F4 graph editor embedded in the wizard dialog —
 * palette, connect, delete, undo/redo, auto-layout and validation markers on
 * the wizard's single yaml draft. No save bar or leave guard: the wizard owns
 * saving and close confirmation. Engine errors with a one-click fix are
 * offered here too, so a draft that blocks Next can be fixed in place.
 */
import { WorkflowGraphEditor } from '../graph-editor/graph-editor'
import { fixFor } from './configure-step'
import type { WizardIssueState } from './use-wizard-validation'

export interface DesignStepProps {
  yaml: string
  onChange: (yaml: string) => void
  issues: WizardIssueState
}

export function DesignStep({ yaml, onChange, issues }: DesignStepProps) {
  const fixes =
    issues.kind === 'ready'
      ? issues.errors.flatMap((issue) => {
          const fix = fixFor(issue)
          return fix ? [{ issue, fix }] : []
        })
      : []
  return (
    <div className="wz2-design">
      <WorkflowGraphEditor embedded={{ yaml, onChange, issues }} />
      {fixes.length > 0 && (
        <div className="wz2-design-fixes" role="group" aria-label="Fixes">
          {fixes.map(({ issue, fix }, i) => (
            <div key={i} className="er">
              ✗ {issue.line != null ? `L${issue.line} · ` : ''}
              {issue.message}{' '}
              <button
                type="button"
                className="wz2-cfg-fix"
                onClick={() => {
                  try {
                    onChange(fix.apply(yaml))
                  } catch {
                    // the draft no longer parses — fix it on Review
                  }
                }}
              >
                {fix.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
