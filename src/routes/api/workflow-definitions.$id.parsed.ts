/**
 * GET /api/workflow-definitions/:id/parsed
 *
 * Fetches the definition (and its raw YAML) from the plugin, then projects
 * a UI-friendly shape locally. The plugin's own parsed endpoint returns a
 * thinner shape than the editor needs; doing the projection here keeps
 * switchui independent of plugin response evolution.
 */
import { createFileRoute } from '@tanstack/react-router'
import { parse as parseYaml } from 'yaml'
import { isAuthenticated } from '../../server/auth-middleware'
import { getEngine } from '../../server/workflow-engine/factory'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type RawNode = Record<string, unknown> & { id?: unknown }

function nodeType(
  node: RawNode,
):
  | 'prompt'
  | 'bash'
  | 'command'
  | 'approval'
  | 'loop'
  | 'router'
  | 'cancel'
  | 'script'
  | 'subgraph' {
  if (node['subgraph']) return 'subgraph'
  if (node['bash']) return 'bash'
  if (node['loop']) return 'loop'
  if (node['approval']) return 'approval'
  if (node['cancel']) return 'cancel'
  if (node['script']) return 'script'
  if (typeof node['command'] === 'string') return 'command'
  return 'prompt'
}

function configPreview(node: RawNode): string {
  const pick: Record<string, unknown> = {}
  for (const key of ['command', 'prompt', 'bash', 'script', 'cancel']) {
    const v = node[key]
    if (v !== undefined) {
      const s = String(v)
      pick[key] = s.length > 80 ? s.slice(0, 80) + '…' : s
    }
  }
  if (node['loop']) pick['loop'] = node['loop']
  if (node['approval']) pick['approval'] = node['approval']
  const str = JSON.stringify(pick)
  return str.length > 200 ? str.slice(0, 200) + '…' : str
}

/**
 * Permissive extraction of required_inputs / optional_inputs from a parsed YAML doc.
 * Supports three shapes:
 *   1) top-level required_inputs / optional_inputs string arrays
 *   2) doc.inputs as array of { name, required? } objects
 *   3) doc.inputs as object keyed by name with { required? } values
 */
function parseInputs(doc: {
  inputs?: unknown
  required_inputs?: unknown
  optional_inputs?: unknown
}): { required_inputs: Array<string>; optional_inputs: Array<string> } {
  // Shape 1: top-level string arrays — union with nested inputs: when both present.
  if (
    Array.isArray(doc.required_inputs) ||
    Array.isArray(doc.optional_inputs)
  ) {
    const req = Array.isArray(doc.required_inputs)
      ? (doc.required_inputs as Array<unknown>).filter((s): s is string => typeof s === 'string')
      : []
    const opt = Array.isArray(doc.optional_inputs)
      ? (doc.optional_inputs as Array<unknown>).filter((s): s is string => typeof s === 'string')
      : []
    // Also union nested inputs: array/object when present alongside top-level arrays.
    if (doc.inputs) {
      const nested = parseInputs({ inputs: doc.inputs })
      for (const n of nested.required_inputs) {
        if (!req.includes(n) && !opt.includes(n)) req.push(n)
      }
      for (const n of nested.optional_inputs) {
        if (!opt.includes(n) && !req.includes(n)) opt.push(n)
      }
    }
    return { required_inputs: req, optional_inputs: opt }
  }

  // Shape 2: inputs array
  if (Array.isArray(doc.inputs)) {
    const req: Array<string> = []
    const opt: Array<string> = []
    for (const item of doc.inputs as Array<unknown>) {
      if (!item || typeof item !== 'object') continue
      const entry = item as Record<string, unknown>
      const name = typeof entry['name'] === 'string' ? entry['name'] : null
      if (!name) continue
      if (entry['required'] === false || entry['required'] === 'false') {
        opt.push(name)
      } else if (entry['required'] === true || entry['required'] === 'true' || entry['required'] == null) {
        req.push(name)
      } else {
        opt.push(name)
      }
    }
    return { required_inputs: req, optional_inputs: opt }
  }

  // Shape 3: inputs object { key: { required? } }
  if (doc.inputs && typeof doc.inputs === 'object' && !Array.isArray(doc.inputs)) {
    const req: Array<string> = []
    const opt: Array<string> = []
    for (const [key, val] of Object.entries(doc.inputs as Record<string, unknown>)) {
      const entry = val && typeof val === 'object' ? (val as Record<string, unknown>) : {}
      if (entry['required'] === false || entry['required'] === 'false') {
        opt.push(key)
      } else if (entry['required'] === true || entry['required'] === 'true' || entry['required'] == null) {
        req.push(key)
      } else {
        opt.push(key)
      }
    }
    return { required_inputs: req, optional_inputs: opt }
  }

  return { required_inputs: [], optional_inputs: [] }
}

export const Route = createFileRoute('/api/workflow-definitions/$id/parsed')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request))
          return json({ error: 'Unauthorized' }, 401)

        const engine = getEngine(request)
        const def = await engine.getDefinition(params.id)
        if (!def) return json({ error: 'not found' }, 404)

        const etag = `"${def.checksum}"`
        const ifNoneMatch = request.headers.get('if-none-match')
        if (ifNoneMatch && ifNoneMatch === etag) {
          return new Response(null, {
            status: 304,
            headers: { ETag: etag, 'Cache-Control': 'private, max-age=30' },
          })
        }

        let doc: {
          name?: string
          description?: string
          nodes?: Array<RawNode>
          inputs?: unknown
          required_inputs?: unknown
          optional_inputs?: unknown
        }
        try {
          doc = parseYaml(def.yaml) ?? {}
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return json({ error: msg, errorType: 'yaml_parse' }, 422)
        }

        const nodes: Array<RawNode> = Array.isArray(doc.nodes) ? doc.nodes : []

        const edges: Array<[string, string]> = []
        for (const node of nodes) {
          const deps = Array.isArray(node['depends_on'])
            ? (node['depends_on'] as Array<unknown>).filter(
                (d): d is string => typeof d === 'string',
              )
            : []
          const id = typeof node.id === 'string' ? node.id : null
          if (!id) continue
          for (const dep of deps) edges.push([dep, id])
        }

        const projectedNodes = nodes.flatMap((node) => {
          const id = typeof node.id === 'string' ? node.id : ''
          // Skip nodes with missing/non-string id — they cannot participate in edges
          // and would corrupt the DAG with empty-string entries.
          if (!id) return []
          const hermesTaskRaw =
            node['hermes_task'] && typeof node['hermes_task'] === 'object'
              ? (node['hermes_task'] as Record<string, unknown>)
              : null
          const hermesTask = hermesTaskRaw
            ? {
                skills: Array.isArray(hermesTaskRaw['skills'])
                  ? (hermesTaskRaw['skills'] as Array<unknown>).filter(
                      (s): s is string => typeof s === 'string',
                    )
                  : [],
                agent_hint:
                  typeof hermesTaskRaw['agent_hint'] === 'string'
                    ? hermesTaskRaw['agent_hint']
                    : null,
                model_hint:
                  typeof hermesTaskRaw['model_hint'] === 'string'
                    ? hermesTaskRaw['model_hint']
                    : null,
              }
            : null
          const subgraphRaw =
            node['subgraph'] && typeof node['subgraph'] === 'object'
              ? (node['subgraph'] as Record<string, unknown>)
              : null
          const subgraph = subgraphRaw
            ? {
                ref: String(subgraphRaw['ref'] ?? ''),
                inputs:
                  subgraphRaw['inputs'] &&
                  typeof subgraphRaw['inputs'] === 'object'
                    ? (subgraphRaw['inputs'] as Record<string, unknown>)
                    : undefined,
                when:
                  typeof subgraphRaw['when'] === 'string'
                    ? subgraphRaw['when']
                    : undefined,
              }
            : null
          const depsArr = Array.isArray(node['depends_on'])
            ? (node['depends_on'] as Array<unknown>).filter(
                (d): d is string => typeof d === 'string',
              )
            : []
          const skillsArr = Array.isArray(node['skills'])
            ? (node['skills'] as Array<unknown>).filter(
                (s): s is string => typeof s === 'string',
              )
            : []
          return [{
            id,
            label: (node['name'] as string | undefined) ?? id,
            type: nodeType(node),
            phase: (node['phase'] as string | undefined) ?? null,
            hermes_task: hermesTask,
            subgraph,
            depends_on: depsArr,
            skills: hermesTask?.skills ?? skillsArr,
            model_hint:
              hermesTask?.model_hint ??
              (node['model'] as string | undefined) ??
              null,
            provider: (node['provider'] as string | undefined) ?? null,
            config_preview: configPreview(node),
          }]
        })

        const payload = {
          definition: def,
          parsed: {
            name: doc.name ?? def.name,
            description: doc.description ?? def.description,
            nodes: projectedNodes,
            edges,
            node_count: nodes.length,
            has_loop: nodes.some((n) => Boolean(n['loop'])),
            has_approval: nodes.some((n) => Boolean(n['approval'])),
            ...parseInputs(doc),
          },
        }
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ETag: etag,
            'Cache-Control': 'private, max-age=30',
          },
        })
      },
    },
  },
})
