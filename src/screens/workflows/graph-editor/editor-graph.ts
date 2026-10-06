/**
 * editor-graph.ts — projects the draft YAML onto the shared Conductor DAG
 * canvas model (buildDag) plus per-node editor metadata (subtitle line,
 * validation marker, disconnected badge). Pure; no React.
 */
import { readGraph } from './yaml-model'
import type { DagModel } from '@/screens/gateway/conductor/dag-model'
import type { NodeType, ParsedWorkflow } from '../types'
import type { EditorGraph } from './yaml-model'
import { buildDag } from '@/screens/gateway/conductor/dag-model'

export interface EditorNodeMeta {
  subtitle: string
  errorText: string | null
  disconnected: boolean
}

export interface EditorDag {
  dag: DagModel
  meta: Record<string, EditorNodeMeta>
  order: Array<string>
  graph: EditorGraph
}

const DISCONNECTED_HINT = 'new · not connected'

export function buildEditorDag(yaml: string): EditorDag | null {
  const graph = readGraph(yaml)
  if (!graph) return null
  const parsed: ParsedWorkflow = {
    name: graph.name,
    description: '',
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      label: n.id,
      type: n.type,
      phase: n.phase,
      depends_on: n.dependsOn,
    })),
    edges: [],
    has_loop: graph.nodes.some((n) => n.type === 'loop'),
    has_approval: graph.nodes.some((n) => n.type === 'approval'),
    required_inputs: [],
    optional_inputs: [],
    node_count: graph.nodes.length,
  }
  const dag = buildDag(parsed)
  const meta: Record<string, EditorNodeMeta> = {}
  graph.nodes.forEach((n, index) => {
    const disconnected = n.dependsOn.length === 0 && index > 0
    meta[n.id] = {
      subtitle: disconnected
        ? n.summary
          ? `${n.summary} · ${DISCONNECTED_HINT}`
          : DISCONNECTED_HINT
        : n.summary || n.type,
      errorText: null,
      disconnected,
    }
  })
  return {
    dag,
    meta,
    order: graph.nodes.map((n) => n.id),
    graph,
  }
}

/** Palette types in board order with their display colours. */
export const PALETTE_TYPES: Array<{ type: NodeType; label: string }> = [
  { type: 'prompt', label: 'Prompt' },
  { type: 'bash', label: 'Bash' },
  { type: 'script', label: 'Script' },
  { type: 'command', label: 'Command' },
  { type: 'approval', label: 'Approval' },
  { type: 'loop', label: 'Loop' },
  { type: 'router', label: 'Router' },
  { type: 'cancel', label: 'Cancel' },
  { type: 'subgraph', label: 'Subgraph' },
]
