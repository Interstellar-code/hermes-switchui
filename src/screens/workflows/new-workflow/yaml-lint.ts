/**
 * Client-side lint for workflow YAML drafts. Produces line-marked issues in the
 * same shape as the backend `validate` feature so both paths render alike.
 * Also hosts the risky-shell scan and the YAML → ParsedWorkflow adapter that
 * feeds read-only graph previews of drafts that are not saved yet.
 */
import { LineCounter, isMap, isScalar, isSeq, parseDocument } from 'yaml'
import { inferNodeType } from './parse-dag'
import type { Node as YamlNode } from 'yaml'
import type { WorkflowValidationIssue } from '../api-client'
import type { ParsedWorkflow } from '../types'

export type LintIssue = WorkflowValidationIssue

export interface LintResult {
  errors: Array<LintIssue>
  warnings: Array<LintIssue>
  /** Node ids found in the draft (first occurrence order). */
  nodeIds: Array<string>
}

export interface RiskyShell {
  node_id: string
  line: number
  reason: string
  snippet: string
}

function pos(
  lc: LineCounter,
  node: YamlNode | null | undefined,
): { line: number; col: number } {
  const offset = node?.range?.[0]
  if (offset == null) return { line: 1, col: 1 }
  return lc.linePos(offset)
}

interface CachedParse {
  doc: ReturnType<typeof parseDocument>
  lc: LineCounter
}

// The wizard lints the same draft several times per keystroke (import pane,
// review checks, risky scan, graph preview). Parsing is the expensive part,
// so keep the last parse keyed by the exact text.
let _cachedText: string | null = null
let _cachedParse: CachedParse | null = null

function parseCached(text: string): CachedParse {
  if (_cachedText === text && _cachedParse) return _cachedParse
  const lc = new LineCounter()
  const doc = parseDocument(text, { lineCounter: lc })
  _cachedText = text
  _cachedParse = { doc, lc }
  return _cachedParse
}

/** Lint a draft. Never throws. */
export function lintWorkflowYaml(text: string): LintResult {
  const errors: Array<LintIssue> = []
  const warnings: Array<LintIssue> = []
  const nodeIds: Array<string> = []
  if (!text.trim()) {
    errors.push({
      line: 1,
      col: 1,
      code: 'empty',
      message: 'The YAML is empty',
    })
    return { errors, warnings, nodeIds }
  }
  const { doc, lc } = parseCached(text)
  for (const err of doc.errors) {
    const p = err.linePos?.[0]
    errors.push({
      line: p?.line ?? 1,
      col: p?.col ?? 1,
      code: 'yaml_parse',
      message: err.message.split('\n')[0] ?? err.message,
    })
  }
  if (errors.length > 0) return { errors, warnings, nodeIds }
  const root = doc.contents
  if (!isMap(root)) {
    errors.push({
      line: 1,
      col: 1,
      code: 'not_a_mapping',
      message: 'The workflow must be a YAML mapping with a `nodes:` list',
    })
    return { errors, warnings, nodeIds }
  }
  const nodes = root.get('nodes', true)
  if (!isSeq(nodes) || nodes.items.length === 0) {
    const p = pos(lc, isSeq(nodes) ? nodes : root)
    errors.push({
      line: p.line,
      col: p.col,
      code: 'no_nodes',
      message: 'The workflow has no nodes',
    })
    return { errors, warnings, nodeIds }
  }

  const seen = new Map<string, number>()
  const deps: Array<{
    id: string
    list: Array<{ ref: string; line: number; col: number }>
  }> = []
  nodes.items.forEach((item, index) => {
    if (!isMap(item)) {
      const p = pos(lc, item as YamlNode)
      errors.push({
        line: p.line,
        col: p.col,
        code: 'node_not_mapping',
        message: `Node ${index + 1} is not a mapping`,
      })
      return
    }
    const idNode = item.get('id', true)
    const idValue = isScalar(idNode) ? idNode.value : null
    if (typeof idValue !== 'string' || !idValue.trim()) {
      const p = pos(lc, item)
      errors.push({
        line: p.line,
        col: p.col,
        code: 'missing_id',
        message: `Node ${index + 1} has no id`,
      })
      return
    }
    const p = pos(lc, idNode)
    if (seen.has(idValue)) {
      errors.push({
        line: p.line,
        col: p.col,
        code: 'duplicate_id',
        message: `duplicate node id “${idValue}” · rename to ${idValue}-2?`,
        node_id: idValue,
      })
    } else {
      seen.set(idValue, p.line)
      nodeIds.push(idValue)
    }
    const dep = item.get('depends_on', true)
    const list: Array<{ ref: string; line: number; col: number }> = []
    if (isSeq(dep)) {
      for (const d of dep.items) {
        if (isScalar(d) && typeof d.value === 'string') {
          const dp = pos(lc, d)
          list.push({ ref: d.value, line: dp.line, col: dp.col })
        }
      }
    }
    deps.push({ id: idValue, list })
  })

  const known = new Set(nodeIds)
  for (const n of deps) {
    for (const d of n.list) {
      if (!known.has(d.ref)) {
        errors.push({
          line: d.line,
          col: d.col,
          code: 'unknown_dependency',
          message: `“${d.ref}” is not a node in this workflow`,
          node_id: n.id,
        })
      }
    }
  }

  // Cycle detection (iterative Kahn — a long chain must not blow the stack).
  const inDegree = new Map<string, number>()
  for (const n of deps) inDegree.set(n.id, 0)
  const adjacency = new Map<string, Array<string>>(deps.map((n) => [n.id, []]))
  for (const n of deps) {
    for (const dep of n.list) {
      if (!inDegree.has(dep.ref)) continue
      inDegree.set(n.id, (inDegree.get(n.id) ?? 0) + 1)
      adjacency.get(dep.ref)?.push(n.id)
    }
  }
  const queue: Array<string> = []
  for (const [id, deg] of inDegree) if (deg === 0) queue.push(id)
  let processed = 0
  while (queue.length > 0) {
    const id = queue.pop() as string
    processed++
    for (const next of adjacency.get(id) ?? []) {
      const deg = (inDegree.get(next) ?? 0) - 1
      inDegree.set(next, deg)
      if (deg === 0) queue.push(next)
    }
  }
  if (processed < inDegree.size) {
    const member = deps.find((n) => (inDegree.get(n.id) ?? 0) > 0)?.id
    if (member) {
      errors.push({
        line: seen.get(member) ?? 1,
        col: 1,
        code: 'cycle',
        message: `Cycle in depends_on involving “${member}”`,
        node_id: member,
      })
    }
  }
  return { errors, warnings, nodeIds }
}

/** Short inline marker for the code view (mockups keep line notes terse). */
export function shortIssueMessage(issue: LintIssue): string {
  switch (issue.code) {
    case 'duplicate_id':
      return 'duplicate id'
    case 'unknown_dependency':
      return 'not a node'
    case 'cycle':
      return 'cycle'
    case 'missing_id':
      return 'no id'
    case 'no_nodes':
      return 'no nodes'
    case 'node_not_mapping':
    case 'not_a_mapping':
      return 'not a mapping'
    case 'yaml_parse':
      return 'bad YAML'
    default:
      return issue.message
  }
}

const RISKY_PATTERNS: Array<[RegExp, string]> = [
  [
    /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh|python3?|node|jq)\b/,
    'Pipes a network download into an interpreter or parser.',
  ],
  [/\brm\s+-[a-zA-Z]*[rR][a-zA-Z]*\s/, 'Recursive delete.'],
  [/\bsudo\b/, 'Runs with elevated privileges.'],
  [/\beval\b/, 'Evaluates a dynamically built command.'],
  [/\bdd\s+if=/, 'Raw disk copy.'],
  [/\bmkfs\b|>\s*\/dev\/(sd|nvme|disk)/, 'Writes to a block device.'],
  [/\bchmod\s+-R\s+777\b/, 'World-writable permissions, recursively.'],
]

/**
 * Scan shell-bearing nodes for commands that deserve an explicit acknowledge.
 * Mirrors the server's risky_shell scope: `bash:`, `script:`, and loop
 * nodes' `until_bash:`.
 */
export function findRiskyShell(text: string): Array<RiskyShell> {
  if (!text.trim()) return []
  const { doc, lc } = parseCached(text)
  const root = doc.contents
  if (doc.errors.length > 0 || !isMap(root)) return []
  const nodes = root.get('nodes', true)
  if (!isSeq(nodes)) return []
  const out: Array<RiskyShell> = []
  for (const item of nodes.items) {
    if (!isMap(item)) continue
    const id = item.get('id')
    const shells: Array<{ node: YamlNode | undefined; command: string }> = []
    for (const key of ['bash', 'script']) {
      const scalar = item.get(key, true)
      if (isScalar(scalar) && typeof scalar.value === 'string')
        shells.push({ node: scalar, command: scalar.value })
    }
    const loop = item.get('loop', true)
    if (isMap(loop)) {
      const until = loop.get('until_bash', true)
      if (isScalar(until) && typeof until.value === 'string')
        shells.push({ node: until, command: until.value })
    }
    for (const { node, command } of shells) {
      for (const [re, reason] of RISKY_PATTERNS) {
        const m = re.exec(command)
        if (!m) continue
        out.push({
          node_id: typeof id === 'string' ? id : '?',
          line: pos(lc, node).line,
          reason,
          snippet: m[0].trim(),
        })
        break
      }
    }
  }
  return out
}

/**
 * Best-effort ParsedWorkflow for a draft (graph preview only). Returns null
 * when the YAML does not yield at least one node.
 */
export function yamlToParsedWorkflow(text: string): ParsedWorkflow | null {
  const doc = parseDocument(text)
  if (doc.errors.length > 0) return null
  const raw = doc.toJS() as unknown
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r['nodes'])) return null
  const nodes: ParsedWorkflow['nodes'] = []
  r['nodes'].forEach((n, i) => {
    if (!n || typeof n !== 'object') return
    const node = n as Record<string, unknown>
    const type = inferNodeType(node)
    nodes.push({
      id: typeof node['id'] === 'string' ? node['id'] : `node-${i + 1}`,
      label: typeof node['id'] === 'string' ? node['id'] : `node-${i + 1}`,
      type,
      depends_on: Array.isArray(node['depends_on'])
        ? node['depends_on'].filter((d): d is string => typeof d === 'string')
        : [],
    })
  })
  if (nodes.length === 0) return null
  const inputs =
    r['inputs'] && typeof r['inputs'] === 'object'
      ? Object.keys(r['inputs'])
      : []
  return {
    name: typeof r['name'] === 'string' ? r['name'] : '',
    description: typeof r['description'] === 'string' ? r['description'] : '',
    nodes,
    edges: [],
    has_loop: nodes.some((n) => n.type === 'loop'),
    has_approval: nodes.some((n) => n.type === 'approval'),
    required_inputs: [],
    optional_inputs: inputs,
    node_count: nodes.length,
  }
}

/** Free-id suggestions for a taken id (`-2`, `-copy`, …). */
export function suggestFreeIds(
  id: string,
  taken: ReadonlySet<string>,
  limit = 3,
): Array<string> {
  const base = id.replace(/-(copy|\d+)$/, '') || id
  const candidates = [
    `${base}-2`,
    `${base}-copy`,
    `${base}-3`,
    `${base}-new`,
    `${base}-4`,
  ]
  return candidates.filter((c) => c !== id && !taken.has(c)).slice(0, limit)
}
