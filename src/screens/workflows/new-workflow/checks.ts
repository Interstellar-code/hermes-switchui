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

  const parseErr = first(errs, PARSE_CODES)
  rows.push({
    key: 'parse',
    state: parseErr ? 'fail' : 'pass',
    text: parseErr
      ? `Line ${parseErr.line} · ${parseErr.message}`
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
        ? `Line ${idErr.line} · ${idErr.message}`
        : 'Every node has a unique id',
    })
    const depErr = first(errs, 'unknown_dependency')
    rows.push({
      key: 'deps',
      state: depErr ? 'fail' : 'pass',
      text: depErr
        ? `Line ${depErr.line} · ${depErr.message}`
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
    if (v.serverPending && !v.server)
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
        text: `Line ${e.line} · ${e.message}`,
      })
    }
    for (const w of v.server?.warnings ?? [])
      rows.push({
        key: `sw-${w.line}-${w.code}-${w.message}`,
        state: 'warn',
        text: `Line ${w.line} · ${w.message}`,
      })
  }

  const scored = rows.filter((r) => r.state !== 'pending' && r.state !== 'warn')
  return {
    rows,
    pass: scored.filter((r) => r.state === 'pass').length,
    total: scored.length,
  }
}
