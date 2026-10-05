import type { NodeType } from './types'

/** Node type -> Matrix neon colour. Shared by the editor, wizard and DAG views. */
export const NODE_COLOR: Record<NodeType | 'subagent', string> = {
  prompt: '#00ff41',
  bash: '#5ad3ff',
  command: '#bf97ff',
  approval: '#ffb454',
  router: '#ff6b6b',
  loop: '#ffd700',
  cancel: '#ff6b6b',
  script: '#5ad3ff',
  subgraph: '#bf97ff',
  subagent: '#bf97ff',
}

export const SUBGRAPH_COLOR = NODE_COLOR.subgraph

const FALLBACK_COLOR = '#00ff41'

export function nodeColor(type: string): string {
  return (NODE_COLOR as Record<string, string>)[type] ?? FALLBACK_COLOR
}
