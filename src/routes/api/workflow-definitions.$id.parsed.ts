/**
 * GET /api/workflow-definitions/:id/parsed
 *
 * Returns the stored YAML parsed into a UI-friendly shape suitable for
 * the Workflow Editor and Launch Wizard (B.4 Path B).
 *
 * Schema gaps (fields absent from WorkflowDefinition after parse):
 *   - required_inputs / optional_inputs: not modelled in schemas/workflow.ts v1;
 *     returned as empty arrays.
 *   - model_hint: not a top-level field on DagNode base — per dag-node.ts the
 *     field is `model` (string | undefined). Exposed as model_hint for UI compat.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { getWorkflowEngine } from '../../server/workflow-engine'
import { parseWorkflow } from '../../server/workflow-engine/discovery/loader'
import {
  isApprovalNode,
  isBashNode,
  isCancelNode,
  isLoopNode,
  isScriptNode,
  isSubgraphNode,
} from '../../server/workflow-engine/schemas'
import type { DagNode } from '../../server/workflow-engine/schemas'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Derive the UI node type string from a parsed DagNode. */
function nodeType(
  node: DagNode,
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
  if (isSubgraphNode(node)) return 'subgraph'
  if (isBashNode(node)) return 'bash'
  if (isLoopNode(node)) return 'loop'
  if (isApprovalNode(node)) return 'approval'
  if (isCancelNode(node)) return 'cancel'
  if (isScriptNode(node)) return 'script'
  if ('command' in node && typeof node.command === 'string') return 'command'
  return 'prompt'
}

/** Short stringification of the most relevant node config fields (≤200 chars). */
function configPreview(node: DagNode): string {
  const raw: Record<string, unknown> = node as unknown as Record<
    string,
    unknown
  >
  const pick: Record<string, unknown> = {}
  for (const key of ['command', 'prompt', 'bash', 'script', 'cancel']) {
    if (raw[key] !== undefined) {
      const val = String(raw[key])
      pick[key] = val.length > 80 ? val.slice(0, 80) + '…' : val
    }
  }
  if (isLoopNode(node)) pick['loop'] = node.loop
  if (isApprovalNode(node)) pick['approval'] = node.approval
  const str = JSON.stringify(pick)
  return str.length > 200 ? str.slice(0, 200) + '…' : str
}

export const Route = createFileRoute('/api/workflow-definitions/$id/parsed')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request))
          return json({ error: 'Unauthorized' }, 401)

        const { store } = await getWorkflowEngine()
        const def = store.getWorkflowDefinition(params.id)
        if (!def) return json({ error: 'not found' }, 404)

        // Codex Bundle 5 Q6 — ETag based on YAML checksum lets the UI's
        // TanStack Query staleTime have server-side backing. Saves the
        // per-request parseWorkflow cost on unchanged definitions.
        const etag = `"${def.checksum}"`
        const ifNoneMatch = request.headers.get('if-none-match')
        if (ifNoneMatch && ifNoneMatch === etag) {
          return new Response(null, {
            status: 304,
            headers: { ETag: etag, 'Cache-Control': 'private, max-age=30' },
          })
        }

        const parsed = parseWorkflow(def.yaml, def.id)
        if (parsed.error !== null) {
          return json(
            { error: parsed.error.error, errorType: parsed.error.errorType },
            422,
          )
        }

        const wf = parsed.workflow
        const nodes = wf.nodes

        // Build edges from depends_on relationships
        const edges: Array<[string, string]> = []
        for (const node of nodes) {
          const deps = (node as { depends_on?: Array<string> }).depends_on ?? []
          for (const dep of deps) {
            edges.push([dep, node.id])
          }
        }

        const projectedNodes = nodes.map((node) => {
          const raw = node as Record<string, unknown>
          const hermesTaskRaw =
            raw['hermes_task'] && typeof raw['hermes_task'] === 'object'
              ? (raw['hermes_task'] as Record<string, unknown>)
              : null
          const hermesTask = hermesTaskRaw
            ? {
                skills: Array.isArray(hermesTaskRaw['skills'])
                  ? hermesTaskRaw['skills'].filter(
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
          // Project subgraph reference when present (A.7-subgraphs).
          const subgraphRaw =
            raw['subgraph'] && typeof raw['subgraph'] === 'object'
              ? (raw['subgraph'] as Record<string, unknown>)
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
          return {
            id: node.id,
            label: (raw['name'] as string | undefined) ?? node.id,
            type: nodeType(node),
            phase: (raw['phase'] as string | undefined) ?? null,
            hermes_task: hermesTask,
            subgraph,
            depends_on:
              (node as { depends_on?: Array<string> }).depends_on ?? [],
            skills:
              hermesTask?.skills ??
              (raw['skills'] as Array<string> | undefined) ??
              [],
            model_hint:
              hermesTask?.model_hint ??
              (raw['model'] as string | undefined) ??
              null,
            provider: (raw['provider'] as string | undefined) ?? null,
            config_preview: configPreview(node),
          }
        })

        const payload = {
          definition: def,
          parsed: {
            name: wf.name,
            description: wf.description,
            nodes: projectedNodes,
            edges,
            node_count: nodes.length,
            has_loop: nodes.some((n) => isLoopNode(n)),
            has_approval: nodes.some((n) => isApprovalNode(n)),
            // required_inputs / optional_inputs: not in v1 schema; empty arrays.
            required_inputs: [] as Array<string>,
            optional_inputs: [] as Array<string>,
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
