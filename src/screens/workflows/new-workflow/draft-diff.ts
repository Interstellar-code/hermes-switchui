/**
 * draft-diff.ts — pure node-level diff between workflow draft revisions.
 * Compares revision N vs revision N-1: added, changed, unchanged, removed.
 */
import { parse as parseYaml } from 'yaml'

export type NodeDiffStatus = 'added' | 'changed' | 'unchanged' | 'removed'

export interface NodeDiff {
  id: string
  status: NodeDiffStatus
  previous?: Record<string, unknown>
  current?: Record<string, unknown>
}

export interface DraftDiffResult {
  added: Array<string>
  changed: Array<string>
  unchanged: Array<string>
  removed: Array<string>
  nodeStatus: Record<string, NodeDiffStatus>
  diffs: Array<NodeDiff>
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }

  if (typeof a === 'object') {
    if (Array.isArray(b)) return false
    const objA = a as Record<string, unknown>
    const objB = b as Record<string, unknown>
    const keysA = Object.keys(objA).filter((k) => objA[k] !== undefined)
    const keysB = Object.keys(objB).filter((k) => objB[k] !== undefined)
    if (keysA.length !== keysB.length) return false
    for (const key of keysA) {
      if (!deepEqual(objA[key], objB[key])) return false
    }
    return true
  }

  return false
}

export function areNodesEqual(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): boolean {
  if (a === b) return true
  if (!a || !b) return false

  const keysA = Object.keys(a).filter((k) => a[k] !== undefined)
  const keysB = Object.keys(b).filter((k) => b[k] !== undefined)

  const allKeys = new Set([...keysA, ...keysB])
  for (const key of allKeys) {
    if (!deepEqual(a[key], b[key])) return false
  }
  return true
}

export function diffDraftNodes(
  prevNodes: Array<Record<string, unknown>> | null | undefined,
  nextNodes: Array<Record<string, unknown>> | null | undefined,
): DraftDiffResult {
  const prevList = prevNodes ?? []
  const nextList = nextNodes ?? []

  const prevMap = new Map<string, Record<string, unknown>>()
  for (const n of prevList) {
    const id = typeof n['id'] === 'string' ? n['id'].trim() : ''
    if (id) prevMap.set(id, n)
  }

  const nextMap = new Map<string, Record<string, unknown>>()
  for (const n of nextList) {
    const id = typeof n['id'] === 'string' ? n['id'].trim() : ''
    if (id) nextMap.set(id, n)
  }

  const added: Array<string> = []
  const changed: Array<string> = []
  const unchanged: Array<string> = []
  const removed: Array<string> = []
  const nodeStatus: Record<string, NodeDiffStatus> = {}
  const diffs: Array<NodeDiff> = []

  for (const [id, nextNode] of nextMap.entries()) {
    if (!prevMap.has(id)) {
      added.push(id)
      nodeStatus[id] = 'added'
      diffs.push({ id, status: 'added', current: nextNode })
    } else {
      const prevNode = prevMap.get(id)!
      if (areNodesEqual(prevNode, nextNode)) {
        unchanged.push(id)
        nodeStatus[id] = 'unchanged'
        diffs.push({
          id,
          status: 'unchanged',
          previous: prevNode,
          current: nextNode,
        })
      } else {
        changed.push(id)
        nodeStatus[id] = 'changed'
        diffs.push({
          id,
          status: 'changed',
          previous: prevNode,
          current: nextNode,
        })
      }
    }
  }

  for (const [id, prevNode] of prevMap.entries()) {
    if (!nextMap.has(id)) {
      removed.push(id)
      nodeStatus[id] = 'removed'
      diffs.push({ id, status: 'removed', previous: prevNode })
    }
  }

  return {
    added,
    changed,
    unchanged,
    removed,
    nodeStatus,
    diffs,
  }
}

export function extractNodesFromYaml(
  yamlStr: string | null | undefined,
): Array<Record<string, unknown>> {
  if (!yamlStr || !yamlStr.trim()) return []
  try {
    const parsed = parseYaml(yamlStr)
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as Record<string, unknown>)['nodes'])
    ) {
      return (
        (parsed as Record<string, unknown>)['nodes'] as Array<unknown>
      ).filter(
        (n): n is Record<string, unknown> =>
          Boolean(n) && typeof n === 'object' && !Array.isArray(n),
      )
    }
  } catch {
    return []
  }
  return []
}

export function diffWorkflowYaml(
  prevYaml: string | null | undefined,
  nextYaml: string | null | undefined,
): DraftDiffResult {
  const prevNodes = extractNodesFromYaml(prevYaml)
  const nextNodes = extractNodesFromYaml(nextYaml)
  return diffDraftNodes(prevNodes, nextNodes)
}
