/**
 * yaml-model.ts — lossless graph ↔ YAML editing model for the workflows v2
 * graph editor (F4).
 *
 * Every operation parses the draft with the `yaml` Document API
 * (`parseDocument`), mutates ONLY the specific keys involved, and
 * re-serialises with `doc.toString()`. Comments, key order, per-node unknown
 * keys and top-level unknown keys all survive round-trips because untouched
 * parts of the document AST are never rebuilt. Pure module: no React, no
 * network — thoroughly unit-tested in yaml-model.test.ts.
 *
 * Engine node schema mirrored here (plugin workflow-engine, dag_node.py):
 *   base: id, phase, depends_on, when, trigger_rule, retry, timeout, …
 *   mode key (exactly one): prompt | bash | script | command | approval |
 *                           loop | cancel | subgraph  (+ UI-side `router`
 *                           placeholder, see F4 report).
 */
import { YAMLMap, isMap, isScalar, isSeq, parseDocument, visit } from 'yaml'
import type { Document, Scalar, YAMLSeq } from 'yaml'
import type { NodeType } from '../types'

/** Mode keys the editor knows; any other key on a node map is preserved but never touched. */
export const MODE_KEYS = [
  'prompt',
  'bash',
  'script',
  'command',
  'approval',
  'loop',
  'cancel',
  'router',
  'subgraph',
] as const

export const TRIGGER_RULES = [
  'all_success',
  'one_success',
  'none_failed_min_one_success',
  'all_done',
] as const

export interface EditorNode {
  id: string
  type: NodeType
  /** Raw `phase:` value (null when absent). */
  phase: string | null
  dependsOn: Array<string>
  /** Full body text (prompt / command / approval.message / …). */
  body: string
  /** Truncated body for the node card. */
  summary: string
  triggerRule: string | null
  /** `retry:` present (max_attempts etc.). */
  hasRetry: boolean
  /** `retry.max_attempts` when present. */
  retryAttempts: number | null
  /** Top-level `timeout:` value when present (seconds). */
  timeout: number | null
}

export interface EditorGraph {
  name: string
  nodes: Array<EditorNode>
}

/** Node ids accept the same charset as workflow ids (WORKFLOW_ID_RE). */
export const NODE_ID_RE = /^[A-Za-z0-9_:.=-]+$/

function nodesSeq(doc: Document): YAMLSeq<YAMLMap> | null {
  const root = doc.contents
  if (!isMap(root)) return null
  const nodes = root.get('nodes', true)
  if (!isSeq(nodes)) return null
  return nodes as YAMLSeq<YAMLMap>
}

function nodeMap(item: unknown): YAMLMap | null {
  return isMap(item) ? item : null
}

function scalarText(v: unknown): string {
  return isScalar(v) && typeof v.value === 'string' ? v.value : ''
}

/**
 * Type inference mirroring src/server/workflow-parsed.ts `nodeType()` (same
 * precedence), plus the UI-only `router:` key. Falls back to 'prompt'.
 */
export function inferEditorNodeType(raw: YAMLMap): NodeType {
  const has = (k: string) => raw.get(k, true) != null
  if (has('subgraph')) return 'subgraph'
  if (has('bash')) return 'bash'
  if (has('loop')) return 'loop'
  if (has('approval')) return 'approval'
  if (has('cancel')) return 'cancel'
  if (has('script')) return 'script'
  if (has('router')) return 'router'
  if (typeof raw.get('command') === 'string') return 'command'
  return 'prompt'
}

/** Read the editable body text of a node (the field the config textarea edits). */
export function nodeBodyText(raw: YAMLMap, type: NodeType): string {
  switch (type) {
    case 'prompt':
    case 'bash':
    case 'script':
    case 'command':
    case 'cancel':
      return scalarText(raw.get(type, true))
    case 'approval': {
      const a = raw.get('approval', true)
      if (!isMap(a)) return ''
      return scalarText(a.get('message', true))
    }
    case 'loop': {
      const l = raw.get('loop', true)
      if (!isMap(l)) return ''
      return scalarText(l.get('prompt', true))
    }
    case 'subgraph': {
      const s = raw.get('subgraph', true)
      if (!isMap(s)) return ''
      return scalarText(s.get('ref', true))
    }
    default:
      return ''
  }
}

function depsOf(raw: YAMLMap): Array<string> {
  const dep = raw.get('depends_on', true)
  if (isScalar(dep) && typeof dep.value === 'string' && dep.value.trim()) {
    return [dep.value.trim()]
  }
  if (!isSeq(dep)) return []
  return dep.items
    .map((d) => (isScalar(d) && typeof d.value === 'string' ? d.value : null))
    .filter((d): d is string => d != null)
}

function summarise(body: string): string {
  const first = body.split('\n')[0] ?? ''
  return first.length > 64 ? `${first.slice(0, 61)}…` : first
}

/** Return parse error string if the text is invalid YAML, or null if valid. */
export function getYamlParseError(text: string): string | null {
  try {
    const doc = parseDocument(text)
    if (doc.errors.length > 0) {
      return doc.errors[0]?.message ?? 'Invalid YAML'
    }
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid YAML'
  }
}

/** Parse the draft into the editor graph view. Null when YAML/nodes are unreadable. */
export function readGraph(text: string): EditorGraph | null {
  let doc: Document
  try {
    doc = parseDocument(text)
  } catch {
    return null
  }
  if (doc.errors.length > 0) return null
  const root = doc.contents
  if (!isMap(root)) return null
  const seq = nodesSeq(doc)
  if (!seq) return null
  const nodes: Array<EditorNode> = []
  for (const item of seq.items) {
    const raw = nodeMap(item)
    if (!raw) continue
    const id = scalarText(raw.get('id', true))
    if (!id) continue
    const type = inferEditorNodeType(raw)
    const timeoutRaw = raw.get('timeout')
    const body = nodeBodyText(raw, type)
    const retry = raw.get('retry', true)
    nodes.push({
      id,
      type,
      phase: (() => {
        const p = raw.get('phase', true)
        return isScalar(p) && typeof p.value === 'string' ? p.value : null
      })(),
      dependsOn: depsOf(raw),
      body,
      summary: summarise(body),
      triggerRule: (() => {
        const t = raw.get('trigger_rule', true)
        return isScalar(t) && typeof t.value === 'string' ? t.value : null
      })(),
      hasRetry: retry != null,
      retryAttempts: (() => {
        if (!isMap(retry)) return null
        const m = retry.get('max_attempts')
        return typeof m === 'number' && Number.isFinite(m) ? m : null
      })(),
      timeout:
        typeof timeoutRaw === 'number' && Number.isFinite(timeoutRaw)
          ? timeoutRaw
          : null,
    })
  }
  if (nodes.length === 0) return null
  return {
    name: scalarText(root.get('name', true)),
    nodes,
  }
}

/** Parse → mutate → serialise. Throws when the draft is not editable YAML. */
function edit(
  text: string,
  mutate: (doc: Document, nodes: YAMLSeq<YAMLMap>) => void,
): string {
  const doc = parseDocument(text)
  if (doc.errors.length > 0) {
    throw new Error('Cannot edit: the draft YAML does not parse')
  }
  let nodes = nodesSeq(doc)
  if (!nodes) {
    const root = doc.contents
    if (!isMap(root)) {
      throw new Error('Cannot edit: the draft has no nodes list')
    }
    // Empty-but-editable draft: create the nodes list on first add.
    ;(root as YAMLMap).set('nodes', doc.createNode([]))
    nodes = nodesSeq(doc)
    if (!nodes) {
      throw new Error('Cannot edit: the draft has no nodes list')
    }
  }
  mutate(doc, nodes)
  return doc.toString({ lineWidth: 0 })
}

function findNode(nodes: YAMLSeq<YAMLMap>, id: string): YAMLMap {
  for (const item of nodes.items) {
    const raw = nodeMap(item)
    if (raw && scalarText(raw.get('id', true)) === id) return raw
  }
  throw new Error(`Node "${id}" not found`)
}

/** Default body per palette type (minimal engine-valid scaffolding). */
export function defaultBodyFor(
  doc: Document,
  type: NodeType,
): { key: string; value: unknown; extra?: Array<[string, unknown]> } {
  switch (type) {
    case 'prompt':
      return { key: 'prompt', value: 'Describe what this node should do' }
    case 'bash':
      return { key: 'bash', value: 'echo hello' }
    case 'script':
      return {
        key: 'script',
        value: 'pass # script body',
        extra: [['runtime', 'uv']],
      }
    case 'command':
      return { key: 'command', value: 'echo hello' }
    case 'approval':
      return {
        key: 'approval',
        value: doc.createNode({ message: 'Approve to continue' }),
      }
    case 'loop':
      return {
        key: 'loop',
        value: doc.createNode({
          prompt: 'Work on the next item',
          until: 'COMPLETE',
          max_iterations: 3,
        }),
      }
    case 'cancel':
      return { key: 'cancel', value: 'stopped by condition' }
    case 'router':
      // UI-side placeholder (see F4 report): `router:` with a routes list.
      return { key: 'router', value: doc.createNode({ routes: [] }) }
    case 'subgraph':
      return {
        key: 'subgraph',
        value: doc.createNode({ ref: 'sub-workflow-id' }),
      }
  }
}

function applyBody(doc: Document, raw: YAMLMap, type: NodeType) {
  // Remove every mode key except the target one (extras like runtime survive).
  for (const key of MODE_KEYS) {
    if (key !== type) raw.delete(key)
  }
  const body = defaultBodyFor(doc, type)
  raw.set(body.key, body.value)
  for (const [k, v] of body.extra ?? []) {
    if (raw.get(k, true) == null) raw.set(k, v)
  }
  // Script requires `runtime`; ensure it survives type conversions to script.
  if (type === 'script' && raw.get('runtime', true) == null) {
    raw.set('runtime', 'uv')
  }
}

/** Append a palette node at the end of `nodes:` (order preserved). */
export function addNode(text: string, type: NodeType, id: string): string {
  return edit(text, (doc, nodes) => {
    if (findNodeOrNull(nodes, id))
      throw new Error(`Id "${id}" is already taken`)
    const raw = new YAMLMap()
    raw.set('id', id)
    const body = defaultBodyFor(doc, type)
    raw.set(body.key, body.value)
    for (const [k, v] of body.extra ?? []) raw.set(k, v)
    nodes.add(raw)
  })
}

function findNodeOrNull(nodes: YAMLSeq<YAMLMap>, id: string): YAMLMap | null {
  for (const item of nodes.items) {
    const raw = nodeMap(item)
    if (raw && scalarText(raw.get('id', true)) === id) return raw
  }
  return null
}

/** Regular expression for $node.output(.attr)? references. */
export const NODE_OUTPUT_REF_RE =
  /\$([a-zA-Z_][a-zA-Z0-9_-]*)\.output(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?/g

/** Also matches ${node.output(.attr)?} references. */
const NODE_OUTPUT_BRACE_REF_RE =
  /\$\{([a-zA-Z_][a-zA-Z0-9_-]*)\.output(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?\}/g

function rewriteOutputRefsInText(
  text: string,
  oldId: string,
  newId: string,
): string {
  let res = text.replace(NODE_OUTPUT_BRACE_REF_RE, (match, prefix, suffix) => {
    if (prefix === oldId) {
      return `\${${newId}.output${suffix ? `.${suffix}` : ''}}`
    }
    return match
  })
  res = res.replace(NODE_OUTPUT_REF_RE, (match, prefix, suffix) => {
    if (prefix === oldId) {
      return `$${newId}.output${suffix ? `.${suffix}` : ''}`
    }
    return match
  })
  return res
}

/** Every string value scalar in the node, nested ones included (loop/with/env/…). */
function forEachTextScalar(raw: YAMLMap, fn: (s: Scalar<string>) => void) {
  visit(raw, {
    Scalar(key, node) {
      if (key !== 'key' && typeof node.value === 'string') {
        fn(node as Scalar<string>)
      }
    },
  })
}

function rewriteOutputRefsInNode(
  raw: YAMLMap,
  oldId: string,
  newId: string,
): void {
  forEachTextScalar(raw, (s) => {
    const next = rewriteOutputRefsInText(s.value, oldId, newId)
    if (next !== s.value) s.value = next
  })
}

/** `$id.output` / `${id.output}` references to node ids that do not exist. */
export function findDanglingOutputRefs(
  text: string,
): Array<{ nodeId: string; refId: string }> {
  let doc: Document
  try {
    doc = parseDocument(text)
  } catch {
    return []
  }
  const seq = doc.errors.length ? null : nodesSeq(doc)
  if (!seq) return []
  const maps = seq.items.map(nodeMap).filter((m): m is YAMLMap => m != null)
  const ids = new Set(maps.map((m) => scalarText(m.get('id', true))))
  const out: Array<{ nodeId: string; refId: string }> = []
  for (const raw of maps) {
    const nodeId = scalarText(raw.get('id', true))
    const seen = new Set<string>()
    forEachTextScalar(raw, (s) => {
      for (const re of [NODE_OUTPUT_BRACE_REF_RE, NODE_OUTPUT_REF_RE]) {
        for (const m of s.value.matchAll(re)) {
          if (!ids.has(m[1]) && !seen.has(m[1])) {
            seen.add(m[1])
            out.push({ nodeId, refId: m[1] })
          }
        }
      }
    })
  }
  return out
}

/** Remove nodes and scrub dangling depends_on references to them. */
export function removeNodes(text: string, ids: Array<string>): string {
  return edit(text, (_doc, nodes) => {
    const gone = new Set(ids)
    nodes.items = nodes.items.filter((item) => {
      const raw = nodeMap(item)
      return !(raw && gone.has(scalarText(raw.get('id', true))))
    })
    for (const item of nodes.items) {
      const raw = nodeMap(item)
      if (!raw) continue
      const dep = raw.get('depends_on', true)
      if (
        isScalar(dep) &&
        typeof dep.value === 'string' &&
        gone.has(dep.value)
      ) {
        raw.delete('depends_on')
      } else if (isSeq(dep)) {
        const kept = dep.items.filter(
          (d) =>
            !(isScalar(d) && typeof d.value === 'string' && gone.has(d.value)),
        )
        if (kept.length === 0) raw.delete('depends_on')
        else dep.items = kept
      }
    }
  })
}

/** Rename a node, rewriting every depends_on reference and $old.output reference to it. */
export function renameNode(text: string, id: string, nextId: string): string {
  const trimmed = nextId.trim()
  if (!NODE_ID_RE.test(trimmed)) {
    throw new Error('Node ids may only contain letters, digits, - _ : . =')
  }
  return edit(text, (_doc, nodes) => {
    if (findNodeOrNull(nodes, trimmed)) {
      throw new Error(`Id "${trimmed}" is already taken`)
    }
    const raw = findNode(nodes, id)
    raw.set('id', trimmed)
    for (const item of nodes.items) {
      const other = nodeMap(item)
      if (!other) continue
      const dep = other.get('depends_on', true)
      if (isScalar(dep) && dep.value === id) {
        dep.value = trimmed
      } else if (isSeq(dep)) {
        for (const d of dep.items) {
          if (isScalar(d) && d.value === id) d.value = trimmed
        }
      }
      rewriteOutputRefsInNode(other, id, trimmed)
    }
  })
}

/** Duplicate a node (deep clone, fresh id, no dependencies). */
export function duplicateNode(
  text: string,
  id: string,
): { yaml: string; newId: string } {
  const graph = readGraph(text)
  if (!graph) throw new Error('Cannot duplicate: draft does not parse')
  const newId = suggestNodeId(
    graph.nodes.map((n) => n.id),
    id,
  )
  const yaml = edit(text, (_doc, nodes) => {
    const raw = findNode(nodes, id)
    // YAMLMap.clone() is typed as Collection but returns a YAMLMap here.
    const copy = raw.clone() as YAMLMap
    copy.set('id', newId)
    copy.delete('depends_on')
    nodes.add(copy)
  })
  return { yaml, newId }
}

/** Set / clear the `phase:` (stage) key. */
export function setNodePhase(
  text: string,
  id: string,
  phase: string | null,
): string {
  return edit(text, (_doc, nodes) => {
    const raw = findNode(nodes, id)
    if (phase == null || phase.trim() === '') raw.delete('phase')
    else raw.set('phase', phase.trim())
  })
}

/** Set the body text for the node's current type. */
export function setNodeBody(text: string, id: string, value: string): string {
  return edit(text, (_doc, nodes) => {
    const raw = findNode(nodes, id)
    const type = inferEditorNodeType(raw)
    switch (type) {
      case 'prompt':
      case 'bash':
      case 'script':
      case 'command':
      case 'cancel':
        raw.set(type, value)
        return
      case 'approval': {
        const a = raw.get('approval', true)
        if (isMap(a)) a.set('message', value)
        else raw.set('approval', { message: value })
        return
      }
      case 'loop': {
        const l = raw.get('loop', true)
        if (isMap(l)) l.set('prompt', value)
        else raw.set('loop', { prompt: value })
        return
      }
      case 'subgraph': {
        const s = raw.get('subgraph', true)
        if (isMap(s)) s.set('ref', value)
        else raw.set('subgraph', { ref: value })
        return
      }
      default:
        return
    }
  })
}

/** Change the node's type: swap the mode key, keep every other key. */
export function setNodeType(text: string, id: string, type: NodeType): string {
  return edit(text, (doc, nodes) => {
    const raw = findNode(nodes, id)
    applyBody(doc, raw, type)
  })
}

/** Add `dep` to node's depends_on (edge dep → node). Throws on self/duplicate. */
export function addDependency(
  text: string,
  nodeId: string,
  depId: string,
): string {
  if (nodeId === depId) throw new Error('A node cannot depend on itself')
  return edit(text, (_doc, nodes) => {
    const raw = findNode(nodes, nodeId)
    findNode(nodes, depId) // must exist
    const dep = raw.get('depends_on', true)
    if (isSeq(dep)) {
      const exists = dep.items.some((d) => isScalar(d) && d.value === depId)
      if (exists) return
      dep.add(depId)
    } else {
      raw.set('depends_on', [depId])
    }
  })
}

/** Remove `dep` from node's depends_on; drops the key when the list empties. */
export function removeDependency(
  text: string,
  nodeId: string,
  depId: string,
): string {
  return edit(text, (_doc, nodes) => {
    const raw = findNode(nodes, nodeId)
    const dep = raw.get('depends_on', true)
    if (!isSeq(dep)) return
    const kept = dep.items.filter((d) => !(isScalar(d) && d.value === depId))
    if (kept.length === 0) raw.delete('depends_on')
    else dep.items = kept
  })
}

/** Set / clear `trigger_rule:`. */
export function setNodeTrigger(
  text: string,
  id: string,
  rule: string | null,
): string {
  return edit(text, (_doc, nodes) => {
    const raw = findNode(nodes, id)
    if (rule == null || rule === '') raw.delete('trigger_rule')
    else raw.set('trigger_rule', rule)
  })
}

/** Set retry.max_attempts (creating the retry map if needed); null clears retry. */
export function setNodeRetry(
  text: string,
  id: string,
  maxAttempts: number | null,
): string {
  return edit(text, (_doc, nodes) => {
    const raw = findNode(nodes, id)
    if (maxAttempts == null) {
      raw.delete('retry')
      return
    }
    const retry = raw.get('retry', true)
    if (isMap(retry)) retry.set('max_attempts', maxAttempts)
    else raw.set('retry', { max_attempts: maxAttempts })
  })
}

/** Set / clear the top-level `timeout:` (seconds). */
export function setNodeTimeout(
  text: string,
  id: string,
  seconds: number | null,
): string {
  return edit(text, (_doc, nodes) => {
    const raw = findNode(nodes, id)
    if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
      raw.delete('timeout')
    } else {
      raw.set('timeout', seconds)
    }
  })
}

/** Free id suggestion: `base-2`, `base-3`, … */
export function suggestNodeId(taken: Array<string>, base: string): string {
  const used = new Set(taken)
  const stem = base.replace(/-(\d+)$/, '') || base
  for (let n = 2; n < 100; n++) {
    const candidate = `${stem}-${n}`
    if (!used.has(candidate)) return candidate
  }
  return `${stem}-${Date.now().toString(36)}`
}

/**
 * Would adding `depId → nodeId` create a cycle? True when nodeId can already
 * reach depId through depends_on edges.
 */
export function wouldCreateCycle(
  text: string,
  depId: string,
  nodeId: string,
): boolean {
  const graph = readGraph(text)
  if (!graph) return false
  const deps = new Map(graph.nodes.map((n) => [n.id, n.dependsOn]))
  // depends_on edge dep → node; cycle iff node ⇝ dep already.
  const stack = [...(deps.get(nodeId) ?? [])]
  const seen = new Set<string>()
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === depId) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    stack.push(...(deps.get(cur) ?? []))
  }
  return false
}
