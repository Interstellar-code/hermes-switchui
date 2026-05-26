/**
 * workflow-yaml-summary.ts — lightweight YAML parsing helpers for the list endpoint.
 *
 * Extracts has_loop, has_approval, required_inputs, optional_inputs from a
 * workflow YAML string without loading the full parsed-endpoint projection.
 */
import { parse as parseYaml } from 'yaml'

type RawNode = Record<string, unknown>

interface WorkflowYamlSummary {
  has_loop: boolean
  has_approval: boolean
  required_inputs: string[]
  optional_inputs: string[]
}

/**
 * Permissive extraction of required_inputs / optional_inputs from a parsed YAML doc.
 * Supports three shapes:
 *   1) top-level required_inputs / optional_inputs string arrays
 *   2) doc.inputs as array of { name, required? } objects
 *   3) doc.inputs as object keyed by name with { required? } values
 */
function extractInputs(doc: Record<string, unknown>): {
  required_inputs: string[]
  optional_inputs: string[]
} {
  // Shape 1: top-level string arrays
  if (Array.isArray(doc['required_inputs']) || Array.isArray(doc['optional_inputs'])) {
    const req = Array.isArray(doc['required_inputs'])
      ? (doc['required_inputs'] as unknown[]).filter((s): s is string => typeof s === 'string')
      : []
    const opt = Array.isArray(doc['optional_inputs'])
      ? (doc['optional_inputs'] as unknown[]).filter((s): s is string => typeof s === 'string')
      : []
    return { required_inputs: req, optional_inputs: opt }
  }

  const inputs = doc['inputs']

  // Shape 2: inputs array
  if (Array.isArray(inputs)) {
    const req: string[] = []
    const opt: string[] = []
    for (const item of inputs as unknown[]) {
      if (!item || typeof item !== 'object') continue
      const entry = item as Record<string, unknown>
      const name = typeof entry['name'] === 'string' ? entry['name'] : null
      if (!name) continue
      if (entry['required'] === false || entry['required'] === 'false') {
        opt.push(name)
      } else {
        req.push(name)
      }
    }
    return { required_inputs: req, optional_inputs: opt }
  }

  // Shape 3: inputs object { key: { required? } }
  if (inputs && typeof inputs === 'object' && !Array.isArray(inputs)) {
    const req: string[] = []
    const opt: string[] = []
    for (const [key, val] of Object.entries(inputs as Record<string, unknown>)) {
      const entry = val && typeof val === 'object' ? (val as Record<string, unknown>) : {}
      if (entry['required'] === false || entry['required'] === 'false') {
        opt.push(key)
      } else {
        req.push(key)
      }
    }
    return { required_inputs: req, optional_inputs: opt }
  }

  return { required_inputs: [], optional_inputs: [] }
}

/**
 * Parse a raw YAML string and return summary flags.
 * Returns all-false/empty on parse error — list must never 500 due to bad YAML.
 */
export function summariseWorkflowYaml(yaml: string): WorkflowYamlSummary {
  try {
    const doc = (parseYaml(yaml) ?? {}) as Record<string, unknown>
    const nodes: RawNode[] = Array.isArray(doc['nodes'])
      ? (doc['nodes'] as unknown[]).filter((n): n is RawNode => !!n && typeof n === 'object')
      : []
    return {
      has_loop: nodes.some((n) => Boolean(n['loop'])),
      has_approval: nodes.some((n) => Boolean(n['approval'])),
      ...extractInputs(doc),
    }
  } catch {
    return { has_loop: false, has_approval: false, required_inputs: [], optional_inputs: [] }
  }
}
