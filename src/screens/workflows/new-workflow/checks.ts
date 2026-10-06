/** Builds the REVIEW checklist from client lint and (when available) server validate. */
import type { LintIssue } from './yaml-lint'
import type { IdStatus, WizardValidation } from './use-wizard-validation'

export type CheckState = 'pass' | 'fail' | 'warn' | 'pending'

export interface CheckRow {
  key: string
  state: CheckState
  text: string
}

const PARSE_CODES = new Set([
  'empty',
  'yaml_parse',
  'not_a_mapping',
  'no_nodes',
])
const ID_CODES = new Set(['missing_id', 'duplicate_id', 'node_not_mapping'])
const LOCAL_CODES = new Set([
  ...PARSE_CODES,
  ...ID_CODES,
  'unknown_dependency',
  'cycle',
])

function first(issues: Array<LintIssue>, codes: ReadonlySet<string> | string) {
  const set = typeof codes === 'string' ? new Set([codes]) : codes
  return issues.find((i) => set.has(i.code))
}

/** "Line 5 · msg" or just "msg" when the engine could not pin a line. */
function linePrefix(issue: LintIssue): string {
  return issue.line != null ? `Line ${issue.line} · ` : ''
}

export function buildChecks(
  v: WizardValidation,
  id: string,
  idStatus: IdStatus,
): { rows: Array<CheckRow>; pass: number; total: number } {
  const errs = v.lint.errors
  const rows: Array<CheckRow> = []

  if (idStatus === 'available')
    rows.push({ key: 'id', state: 'pass', text: `Workflow id ${id} is free` })
  else if (idStatus === 'taken')
    rows.push({
      key: 'id',
      state: 'fail',
      text: `Workflow id ${id} is already taken`,
    })
  else if (idStatus === 'invalid' || idStatus === 'empty')
    rows.push({
      key: 'id',
      state: 'fail',
      text:
        idStatus === 'empty'
          ? 'Workflow id is required'
          : 'Workflow id must be 1–128 chars of [A-Za-z0-9_:.-]',
    })
  else if (idStatus === 'checking')
    rows.push({ key: 'id', state: 'pending', text: 'Checking the id…' })
  else
    rows.push({
      key: 'id',
      state: 'fail',
      text: 'Cannot confirm the id is free yet — the workflow catalog is loading or unreachable. Retry below.',
    })

  const parseErr = first(errs, PARSE_CODES)
  rows.push({
    key: 'parse',
    state: parseErr ? 'fail' : 'pass',
    text: parseErr
      ? `${linePrefix(parseErr)}${parseErr.message}`
      : v.hasValidate && v.server?.ok
        ? 'YAML parses · schema valid'
        : 'YAML parses',
  })
  if (!parseErr) {
    const idErr = first(errs, ID_CODES)
    rows.push({
      key: 'ids',
      state: idErr ? 'fail' : 'pass',
      text: idErr
        ? `${linePrefix(idErr)}${idErr.message}`
        : 'Every node has a unique id',
    })
    const depErr = first(errs, 'unknown_dependency')
    rows.push({
      key: 'deps',
      state: depErr ? 'fail' : 'pass',
      text: depErr
        ? `${linePrefix(depErr)}${depErr.message}`
        : 'Every depends_on points to a real node',
    })
    const cycleErr = first(errs, 'cycle')
    rows.push({
      key: 'cycle',
      state: cycleErr ? 'fail' : 'pass',
      text: cycleErr ? cycleErr.message : 'No cycles in the graph',
    })
  }

  // Backend-only rows: absent without the `validate` feature.
  if (v.hasValidate) {
    if (v.serverFailed)
      rows.push({
        key: 'server-failed',
        state: 'warn',
        text: 'Server validation failed — using local checks',
      })
    else if (v.serverPending && !v.server)
      rows.push({
        key: 'server',
        state: 'pending',
        text: 'Validating on the server…',
      })
    const seen = new Set(errs.map((e) => `${e.line}:${e.message}`))
    for (const e of v.server?.errors ?? []) {
      if (LOCAL_CODES.has(e.code) && seen.has(`${e.line}:${e.message}`))
        continue
      rows.push({
        key: `se-${e.line}-${e.code}-${e.message}`,
        state: 'fail',
        text: `${linePrefix(e)}${e.message}`,
      })
    }
    // risky_shell warnings gate Save via the acknowledge checkbox instead.
    for (const w of v.server?.warnings ?? []) {
      if (w.code === 'risky_shell') continue
      rows.push({
        key: `sw-${w.line}-${w.code}-${w.message}`,
        state: 'warn',
        text: `${linePrefix(w)}${w.message}`,
      })
    }
  }

  const scored = rows.filter((r) => r.state !== 'pending' && r.state !== 'warn')
  return {
    rows,
    pass: scored.filter((r) => r.state === 'pass').length,
    total: scored.length,
  }
}
