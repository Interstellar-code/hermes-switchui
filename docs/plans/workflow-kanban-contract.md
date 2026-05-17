# Workflow / Kanban Contract Plan

## Decision

Adopt a lightweight workflow-owned metadata contract for `/workflows`:

1. `workflow_runs.current_phase` and `phase_transitions` are the run lifecycle source of truth.
2. YAML node `phase` is display/grouping metadata only. It must not affect routing, dispatch, retries, resume, or phase transitions.
3. `node_runs.kanban_task_id` is the execution join to Hermes Kanban. Hermes Kanban owns task lifecycle, comments, task runs, and worker state.
4. Plan artifacts are workflow-owned, run-scoped outputs surfaced through persisted node/run data first. Live `workflow_artifact` SSE can augment later only when a producer is verified.
5. Future richer metadata must use an explicit workflow-owned extension path such as `hermes_task` or a future namespaced extension, not ambiguous top-level fields.

## Vocabulary

- **Workflow template**: stored YAML definition.
- **DAG node**: YAML `nodes[]` entry. Optional `phase` labels are visual only.
- **Workflow run**: one launch instance in `workflow_runs`.
- **Run wrapper phase**: engine lifecycle value in `workflow_runs.current_phase` and `phase_transitions`.
- **Node run**: execution instance of a DAG node in `node_runs`.
- **Hermes Kanban task**: gateway-owned execution work item linked by `node_runs.kanban_task_id`.
- **Plan artifact**: run-scoped planning output referenced from workflow-owned node/run projection, not from Kanban task state alone.

## Kanban rule

`hermes_task:` marks a node as Hermes/Kanban task-backed in the template/editor view. At runtime, a Kanban task is expected only for eligible dispatched AI nodes. `kanban_task_id = null` is valid for:

- `bash`
- `script`
- `loop`
- `approval`
- `cancel`
- not-yet-dispatched nodes

A missing `kanban_task_id` is a defect only for an eligible AI node after successful dispatch.

## UI ownership

- **Visual DAG**: shows node type, display phase, and whether the node is `hermes_task` backed. It does not show live Kanban state.
- **History tab**: lists workflow runs from `GET /api/workflow-runs?workflow_id=<id>`.
- **Run Detail panel**: owns phase timeline, node run status, `kanban_task_id`, summaries, and artifact links.
- **Launch Wizard**: remains launch/input focused. Cron UI is deferred.

## Implementation slices

1. Persist and project display-only node `phase` and `hermes_task` metadata.
2. Replace mock History tab with real workflow run list and open-run callback.
3. Enhance Run Detail node rows with Kanban link/status affordance and artifact refs when present.
4. Patch bundled templates conservatively with phase labels and missing `hermes_task` hints.
5. Defer cron UI and any semantic use of node `phase`.

## Verification

- Schema/parser accepts `phase` without changing execution semantics.
- Parsed workflow endpoint returns `phase` and `hermes_task` for editor use.
- History tab queries runs filtered by workflow id.
- Run detail renders null `kanban_task_id` safely and labels it as expected for local/control/not-dispatched nodes.
- Run detail renders artifact refs without relying on SSE-only state.
- Bundled workflow defaults parse after YAML annotation changes.
- Cron code remains untouched except boundary docs.
