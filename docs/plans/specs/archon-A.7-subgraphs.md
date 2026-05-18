# Spec: A.7-subgraphs — Reusable Subgraph Primitive

> **Workstream:** A (Archon engine port) — A.7 polish enabler
> **Owner:** Executor team (parallelizable across 4 tracks)
> **Status:** Ready for implementation
> **Depends on:** A.1 (engine port), A.1.1 (store), A.8 (5-phase wrapper) — all shipped
> **Blocks:** A.7 v1 workflow polish for `smart-pr-review`, `fix-github-issue`, `plan-to-pr`, `idea-to-pr` (each needs the 5-agent PR-review subgraph)

## Goal

Add a first-class **subgraph** primitive to the workflow engine so common multi-node patterns (5-agent PR review fan-out, plan-setup chain, PRD-generation chain) can be defined once and referenced from many top-level workflows. Eliminate copy-paste of ~1,250 lines of duplicated YAML across the v1 subset.

A subgraph is conceptually a **function in YAML**: it has a name, inputs, a body of nodes, and an output. It does not own a workflow run — it is expanded into the parent workflow's run at execution time, producing child `node_runs` rows linked back to the parent via a new foreign key.

## Non-goals

- **Recursive subgraphs.** A subgraph may not (directly or transitively) reference itself. Validated at load time via DFS cycle check.
- **Dynamic subgraph selection.** The reference is a static string in YAML, not an expression. `subgraph: $foo` is rejected.
- **Cross-workflow live state.** Subgraphs do NOT share state across runs — each expansion is independent.
- **Loop-of-subgraph.** A `loop:` node that wraps a `subgraph:` node is out of scope for v1.1. Add later if needed.

## Schema design

### New DagNode field: `subgraph`

```ts
// src/server/workflow-engine/schemas/dag-node.ts
subgraph: z
  .object({
    ref: z.string().min(1).regex(/^[a-z0-9-]+$/),          // subgraph id (kebab-case)
    inputs: z.record(z.string(), z.unknown()).optional(),  // variable bindings
    when: z.string().optional(),                           // condition gate (same as node-level)
    // Subgraph-as-node fields that pass through to all child nodes when set:
    timeout: z.number().int().positive().optional(),
    max_retries: z.number().int().nonnegative().optional(),
  })
  .optional(),
```

A node with `subgraph:` is mutually exclusive with `prompt:` / `command:` / `bash:` / `script:` / `loop:` / `approval:` / `cancel:`. Enforced by a Zod refinement.

`hermes_task` is NOT allowed on a subgraph node — routing hints come from each child node's own `hermes_task` block.

### New top-level workflow kind: subgraph definition

A workflow YAML may declare itself as a subgraph instead of a runnable workflow:

```yaml
kind: subgraph              # NEW — when present, this YAML is a subgraph, not a workflow
id: pr-review-5agents       # required when kind=subgraph
inputs:                     # named inputs the parent must bind
  - name: pr_number
    type: string
    required: true
  - name: pr_diff_path
    type: string
    required: false
outputs:                    # named outputs exposed to parent
  - name: synthesis
    from: synthesize.output  # which inner node's output to surface
nodes:
  - id: code-review
    hermes_task: {...}
    prompt: |
      Review PR #$INPUTS.pr_number ...
  - id: error-handling
    ...
  ...
```

When `kind:` is absent or `kind: workflow`, parser behaves as today.

### Storage shape

Subgraph definitions reuse the existing `workflow_definitions` table with a new column:

```sql
ALTER TABLE workflow_definitions ADD COLUMN kind TEXT NOT NULL DEFAULT 'workflow';
-- 'workflow' | 'subgraph'
CREATE INDEX idx_wd_kind ON workflow_definitions(kind);
```

Subgraphs are listed on `/workflows` only if `?source=subgraph` filter is requested (UI hides them by default in the library grid; surface them on a dedicated tab later).

### `node_runs` parent linkage

Add a column to record subgraph expansion parent:

```sql
ALTER TABLE node_runs ADD COLUMN parent_subgraph_node_run_id TEXT
  REFERENCES node_runs(id) ON DELETE CASCADE;
CREATE INDEX idx_nr_subgraph ON node_runs(parent_subgraph_node_run_id);
```

When a subgraph node expands, the engine creates one **placeholder** `node_runs` row for the subgraph-node itself (status tracks the aggregate of children), plus one `node_runs` row per child node with `parent_subgraph_node_run_id` set to the placeholder.

### Variable scoping

Inside a subgraph body, two new variable namespaces are available:
- `$INPUTS.<name>` — resolves to the value bound by the parent at the subgraph reference site.
- `$<inner-node-id>.output` — same as today, scoped to the subgraph's child nodes only.

Outside the subgraph, after the subgraph node completes, the parent workflow accesses subgraph outputs via:
- `$<subgraph-node-id>.outputs.<name>` — e.g. `$review.outputs.synthesis`

The existing `$<node-id>.output` continues to work for non-subgraph nodes. The `.outputs.<name>` accessor is **new** and only valid on subgraph nodes.

## Engine changes

### Track 1 — Schema + Loader (`src/server/workflow-engine/schemas/` + `discovery/loader.ts`)

1. Extend `dagNodeSchema` with the optional `subgraph` block and the mutual-exclusion refinement.
2. Add `workflowKindSchema` and parse the new `kind:` top-level field. When `kind: subgraph`, validate `id:`, `inputs:`, `outputs:` blocks; reject `nodes` that reference parent-only fields like `phases:`.
3. `parseWorkflow` returns either `ParseResult` (existing) or `ParseSubgraphResult` (new). Callers discriminate on `kind`.
4. Recursive-reference detection: after parsing, walk every `subgraph.ref` and DFS-resolve through the store. Reject cycles with a clear error.
5. Validate that every `inputs[*]` required by the subgraph definition is bound by `subgraph.inputs` at every reference site. Missing required → load-time error.

**Deliverables:** schema files updated, `parseWorkflow` returns discriminated union, new test suite at `schemas/subgraph.test.ts`.

### Track 2 — Executor + Store (`src/server/workflow-engine/core/dag-executor.ts` + `store/workflow-store.ts`)

1. New `createNodeRun` field `parent_subgraph_node_run_id: string | null` (plumbed through `IWorkflowStoreUpsertInput`).
2. `dag-executor` gains a `expandSubgraph(node, parentRunId, inputs)` helper:
   - Fetches subgraph definition from store via `node.subgraph.ref`.
   - Re-parses (or pulls from a per-engine cache) the subgraph YAML.
   - For each inner node, deep-clones it, rewrites id to `<parent-node-id>.<inner-id>`, rewrites `$INPUTS.<name>` references in any string field to the bound value, rewrites inter-node references (`$x.output`) to the namespaced form.
   - Returns a list of materialised `DagNode` rows scoped to this expansion.
3. The DAG executor's layer-walking algorithm gains an "expansion" pass: when it encounters a `subgraph:` node, it expands inline before scheduling, producing the placeholder `node_runs` row + the child rows.
4. Output aggregation: when all children for a subgraph node complete, the engine computes the placeholder's `summary` from the subgraph's declared `outputs[*].from` paths.
5. **Cancellation** — cancelling a subgraph node cascades cancel to all children with the same `parent_subgraph_node_run_id`.

**Deliverables:** executor + store changes, integration test at `core/subgraph-execution.test.ts` covering happy path, child failure, cancellation cascade, `when:` skip on the subgraph node.

### Track 3 — Projector + Events (`src/server/workflow-engine/projector/node-runs-projector.ts` + `emitter/event-emitter.ts`)

1. New event types:
   ```ts
   { type: 'subgraph_started', runId, nodeId, nodeRunId }
   { type: 'subgraph_completed', runId, nodeId, summary }
   { type: 'subgraph_failed', runId, nodeId, error }
   ```
2. Projector consumes new events, materialises the placeholder row, marks completion when all children settle.
3. SSE bridge forwards new event types to clients.

**Deliverables:** projector + emitter + SSE bridge updates, projector test additions.

### Track 4 — UI (`src/screens/workflows/` + RunDetailPanel + WorkflowEditor)

1. DAG renderer (Kahn's-algorithm SVG in WorkflowEditor + LaunchWizard Step2Route): subgraph nodes render as a collapsed rectangle with a chevron; expand-on-click reveals the child layer in-line.
2. RunDetailPanel: node table groups child rows under the subgraph parent (indent + tree-toggle). Status chip on the parent shows aggregate (e.g. "3/5 running").
3. Library grid: hide `kind=subgraph` definitions by default. Filter chip "Show subgraphs" exposes them.

**Deliverables:** SVG renderer changes, node table changes, library filter, visual tests.

### Track 5 — First migration (`src/server/workflow-engine/defaults/bundled-defaults.generated.ts` + new subgraph YAML)

1. Author `subgraphs/pr-review-5agents.yaml` (5 review agents + synthesizer + auto-fix). Single source of truth.
2. Update `archon-smart-pr-review` to drop the inlined 5-agent block, replace with a single `subgraph:` reference.
3. Same for `archon-fix-github-issue`, `archon-plan-to-pr`, `archon-idea-to-pr`.
4. Update `seedBundledWorkflows` to seed subgraph definitions (`kind=subgraph`) alongside workflows.

**Deliverables:** new subgraph YAML, 4 v1 workflows trimmed, seed updates, end-to-end smoke test runs `smart-pr-review` against a fixture PR and verifies subgraph expansion in DB.

## Cross-track contract (the interface)

To enable parallel work, lock these signatures **before** track implementation starts:

```ts
// schemas/dag-node.ts
export interface SubgraphReference {
  ref: string;
  inputs?: Record<string, unknown>;
  when?: string;
  timeout?: number;
  max_retries?: number;
}

// store/types.ts — new field on IWorkflowStoreUpsertInput for createNodeRun
parent_subgraph_node_run_id?: string;

// emitter/event-emitter.ts — three new event variants (see Track 3)

// dag-executor.ts — public expandSubgraph signature
export function expandSubgraph(
  node: DagNode & { subgraph: SubgraphReference },
  parentRunId: string,
  parentNodeRunId: string,
  store: IWorkflowStore,
): Promise<{ placeholderRunId: string; childNodes: Array<DagNode> }>;
```

Tracks may proceed in parallel once these are landed. Track 5 starts only after Tracks 1+2 are integration-green.

## Testing strategy

### Unit
- `schemas/subgraph.test.ts` — schema parsing happy/sad paths
- `discovery/loader-subgraph.test.ts` — cycle detection, missing input rejection
- `core/subgraph-expansion.test.ts` — expansion correctness, namespace rewriting

### Integration
- `core/subgraph-execution.test.ts` — full run with a 3-node test subgraph + 2-node parent
- Cancellation: parent run cancelled → all subgraph children cancelled
- Skip: `subgraph.when` false → placeholder marked skipped, no child rows
- Failure: one child fails → parent marked failed, sibling cancellation applies

### End-to-end
- Smoke test: launch the migrated `archon-smart-pr-review` against a fixture PR, verify:
  - 1 placeholder + 8 child `node_runs` rows created
  - Kanban tasks created with correct `assignee` per child's `agent_hint`
  - Parent run transitions execute → report after subgraph completes

## Risks

| Risk | Mitigation |
|---|---|
| Namespaced node IDs (`review.code-review`) break existing variable substitution in prompts | Add `$<simple-id>` resolution INSIDE the subgraph body too — if both `review.code-review.output` and `code-review.output` are accepted within the subgraph, authors can copy the original inline YAML verbatim. |
| Subgraph expansion creates large numbers of node_runs rows on highly-fanned workflows | Add a cap (e.g. 100 children per expansion) and warn at load time if the count is high. |
| Cycle detection misses transitive cycles spanning workflow boundaries | DFS visits subgraph definitions during workflow load, not just at subgraph load. Cache visited set per top-level workflow. |
| Migration regressions in existing v1 workflows | Keep the inlined version of each workflow committed under `.archon/legacy-inlined/` as a fallback during the migration; revert is `git mv`. |
| UI rendering becomes confusing with deeply-nested subgraphs | v1.1 limit: subgraph depth = 1 (a subgraph may not reference another subgraph). Raise after UX validation. |

## Parallel work plan

```
Day 1 (sequential, contract phase):
  - Lock the cross-track interface (above) in a stub-only PR
  - Land empty types + event variants + store column migration
  - Document expansion algorithm in detail

Day 2-3 (parallel, 4 tracks):
  Track 1: Schema + Loader            [Sonnet executor]
  Track 2: Executor + Store           [Opus executor — most complex]
  Track 3: Projector + Events + SSE   [Sonnet executor]
  Track 4: UI rendering               [Sonnet executor + Designer review]

Day 4 (sequential, integration):
  - Merge tracks 1+2 first (engine green)
  - Track 5: Author pr-review-5agents subgraph + migrate one consumer
  - Integration test passes
  - Migrate the other 3 consumers

Day 5: end-to-end smoke + PR.
```

Each track must land behind a runtime flag (`HERMES_ENABLE_SUBGRAPHS`) until Track 5 ships, so the engine stays usable during the build-out.

## Success criteria

1. New subgraph YAML at `~/.hermes/switchui-workflows.db` with `kind=subgraph`, listable via `GET /api/workflow-definitions?source=subgraph`.
2. `archon-smart-pr-review` references `pr-review-5agents` via `subgraph:`; runs end-to-end producing 1 placeholder + 8 child node_runs.
3. Editing the subgraph YAML changes behavior in all 4 consuming workflows.
4. Codex audit: 0 blocker findings on the subgraph-primitive change set.
5. Documentation: `docs/workflows/subgraphs.md` user-facing guide written.

## Open questions to resolve before implementation

1. **Subgraph versioning.** If a workflow pins `subgraph: pr-review-5agents@v2`, do we need a version field? v1: no — subgraphs are identified by id only, latest definition wins. Revisit if drift becomes a problem.
2. **Inputs/outputs typing strictness.** v1: `unknown` everywhere, parent passes whatever, subgraph reads strings via variable substitution. v1.1: JSON Schema on inputs?
3. **DAG visualization scaling.** A subgraph with 8 children inside a workflow with 22 nodes pushes the SVG renderer beyond its current ~30-node sweet spot. Designer eval needed during Track 4.
