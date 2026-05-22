# Workflow Engine as Hermes Agent Plugin — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Extract the Switch UI workflow engine into a Hermes Agent plugin so the backend logic (DAG execution, SQLite state, YAML discovery, event streaming) runs inside the Hermes Agent process, while the Switch UI frontend consumes it via `/api/plugins/workflows/*` API routes.

**Architecture:** Two-sided extraction. The Hermes Agent side gets a new `plugins/workflows/` directory with a `plugin.yaml`, `__init__.py` (register function), `plugin_api.py` (FastAPI routes), and the engine core (ported from TypeScript to Python or — if the engine stays TypeScript — run as a subprocess with a JSON-RPC bridge). The Switch UI side keeps all frontend code (workflow editor, conductor, mission control) and replaces direct `workflow-engine` imports with HTTP calls to `/api/plugins/workflows/*`.

**Tech Stack:** Python (Hermes Agent plugin), FastAPI (plugin API routes), SQLite (workflow state), YAML (workflow definitions), TypeScript (Switch UI frontend unchanged)

---

## Key Architectural Decision: Python Port vs TypeScript Subprocess

Before starting implementation, decide which path:

### Option A: Python Port (Recommended)
- Port the ~14K LOC TypeScript engine to Python
- Runs natively inside Hermes Agent process
- Full access to Hermes tools, sessions, provider registry
- Follows the same pattern as the Kanban plugin
- Higher upfront cost, zero runtime complexity

### Option B: TypeScript Subprocess
- Keep the engine as-is, launch as a sidecar process
- Communicate via JSON-RPC or REST over localhost
- Faster to extract, but adds process management, port allocation, health checks
- The engine can't directly call Hermes tools — needs an adapter bridge

### Option C: Hybrid (Engine stays in Switch UI, plugin is just API surface)
- Don't extract at all — leave the engine running in Switch UI's TanStack Start server
- Create a thin Hermes plugin that exposes `/api/plugins/workflows/*` as a reverse proxy to Switch UI's existing routes
- Minimal effort, but doesn't achieve real plugin status — just adds an indirection layer

**Recommendation:** Option A. The engine is ~57 production files, ~14K LOC. The stubs already prove it's self-contained. A Python port is the clean path and follows the established Kanban plugin precedent.

The plan below assumes **Option A**.

---

## Phase 1: Plugin Skeleton and Contract

### Task 1: Create plugin directory and manifest

**Objective:** Scaffold the plugin directory with the minimum viable manifest and registration.

**Files:**
- Create: `plugins/workflows/plugin.yaml`
- Create: `plugins/workflows/__init__.py`

**Step 1: Create plugin.yaml**

```yaml
name: workflows
version: 0.1.0
description: "DAG-based workflow engine — YAML-defined workflows with prompt, bash, script, loop, approval, and command node types. SQLite state persistence, event streaming, cron triggers."
author: "Interstellar"
kind: standalone
hooks:
  - on_session_start
  - on_session_end
provides_tools:
  - workflow_run
  - workflow_list
  - workflow_status
```

**Step 2: Create __init__.py with register()**

```python
"""Workflow engine plugin — DAG-based workflow execution."""
from __future__ import annotations
import logging
from typing import Any, Dict
from hermes_cli.plugins import PluginContext

logger = logging.getLogger(__name__)

def register(ctx: PluginContext) -> None:
    """Called by the plugin loader during startup."""
    logger.info("workflows plugin registering (engine init deferred to first use)")
    # Engine initialization is lazy — see engine.py
    ctx.register_tool(
        name="workflow_run",
        toolset="workflow",
        schema={
            "type": "object",
            "properties": {
                "workflow": {"type": "string", "description": "Workflow name or path"},
                "args": {"type": "string", "description": "Arguments to pass to the workflow"},
            },
            "required": ["workflow"],
        },
        handler=_handle_workflow_run,
        description="Run a named YAML workflow",
    )
    ctx.register_tool(
        name="workflow_list",
        toolset="workflow",
        schema={"type": "object", "properties": {}},
        handler=_handle_workflow_list,
        description="List available workflows",
    )
    ctx.register_tool(
        name="workflow_status",
        toolset="workflow",
        schema={
            "type": "object",
            "properties": {
                "run_id": {"type": "string", "description": "Run ID to check"},
            },
            "required": ["run_id"],
        },
        handler=_handle_workflow_status,
        description="Check status of a workflow run",
    )

# Stub handlers — replaced in Phase 2
def _handle_workflow_run(**kwargs): ...
def _handle_workflow_list(**kwargs): ...
def _handle_workflow_status(**kwargs): ...
```

**Step 3: Verify plugin loads**

Run: `hermes plugins list`
Expected: `workflows` appears in the list (disabled by default)

Run: `hermes plugins enable workflows`
Expected: Plugin enabled confirmation

**Step 4: Commit**

```bash
git add plugins/workflows/
git commit -m "feat(workflows): scaffold plugin with manifest and register()"
```

---

### Task 2: Create dashboard manifest and API skeleton

**Objective:** Add the dashboard plugin manifest so Switch UI can discover and render the workflow tab, plus a minimal FastAPI router.

**Files:**
- Create: `plugins/workflows/dashboard/manifest.json`
- Create: `plugins/workflows/dashboard/plugin_api.py`

**Step 1: Create manifest.json**

```json
{
  "name": "workflows",
  "label": "Workflows",
  "description": "DAG-based workflow engine — define, run, and monitor YAML workflows with prompt, bash, script, loop, approval, and command nodes.",
  "icon": "GitBranch",
  "version": "0.1.0",
  "tab": {
    "path": "/workflows",
    "position": "after:kanban"
  },
  "api": "plugin_api.py"
}
```

Note: No `entry` or `css` fields — the UI is served by Switch UI itself, not by a bundled JS asset. The plugin only provides the backend API.

**Step 2: Create plugin_api.py with health endpoint**

```python
"""Workflow engine — dashboard plugin API routes.

Mounted at /api/plugins/workflows/ by the dashboard plugin system.
"""
from __future__ import annotations
from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.get("/health")
async def health():
    """Plugin health check."""
    return {"status": "ok", "plugin": "workflows", "version": "0.1.0"}


@router.get("/workflows")
async def list_workflows():
    """List discovered workflow definitions."""
    # Phase 2: wire to engine
    return {"workflows": []}


@router.get("/runs")
async def list_runs():
    """List workflow runs."""
    # Phase 2: wire to engine
    return {"runs": []}
```

**Step 3: Verify API mounts**

Start the dashboard: `hermes dashboard`
Check: `curl http://localhost:9119/api/plugins/workflows/health`
Expected: `{"status": "ok", "plugin": "workflows", "version": "0.1.0"}`

**Step 4: Commit**

```bash
git add plugins/workflows/dashboard/
git commit -m "feat(workflows): add dashboard manifest and API skeleton"
```

---

### Task 3: Define the engine interface contract

**Objective:** Define the Python interface that the engine must implement, matching the current TypeScript engine's public API surface.

**Files:**
- Create: `plugins/workflows/engine_interface.py`

**Step 1: Write the interface**

```python
"""Workflow engine — abstract interface.

Defines the contract that any engine implementation must satisfy.
The TypeScript engine's public API surface is the reference;
this is its Python equivalent.
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncIterator, Dict, List, Optional


class NodeKind(str, Enum):
    PROMPT = "prompt"
    BASH = "bash"
    SCRIPT = "script"
    LOOP = "loop"
    APPROVAL = "approval"
    CANCEL = "cancel"
    COMMAND = "command"
    SUBGRAPH = "subgraph"


class RunPhase(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class NodeStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"
    WAITING_APPROVAL = "waiting_approval"


@dataclass
class WorkflowDefinition:
    name: str
    description: str = ""
    nodes: List[Dict[str, Any]] = field(default_factory=list)
    hooks: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class WorkflowRun:
    id: str
    workflow_name: str
    phase: RunPhase
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    error: Optional[str] = None


@dataclass
class NodeRun:
    id: str
    run_id: str
    node_id: str
    node_type: NodeKind
    status: NodeStatus
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    output: Optional[str] = None
    error: Optional[str] = None


class WorkflowEngine(ABC):
    """Abstract workflow engine — all methods the plugin API needs."""

    @abstractmethod
    async def discover_workflows(self) -> List[WorkflowDefinition]:
        """Scan ~/.hermes/workflows/ for YAML workflow definitions."""

    @abstractmethod
    async def get_workflow(self, name: str) -> Optional[WorkflowDefinition]:
        """Get a single workflow definition by name."""

    @abstractmethod
    async def launch_run(self, workflow_name: str, args: Optional[str] = None) -> WorkflowRun:
        """Create and start a new workflow run."""

    @abstractmethod
    async def get_run(self, run_id: str) -> Optional[WorkflowRun]:
        """Get a workflow run by ID."""

    @abstractmethod
    async def list_runs(self, limit: int = 50) -> List[WorkflowRun]:
        """List recent workflow runs."""

    @abstractmethod
    async def cancel_run(self, run_id: str) -> bool:
        """Cancel a running workflow."""

    @abstractmethod
    async def approve_node(self, run_id: str, node_id: str, response: Optional[str] = None) -> bool:
        """Approve a node waiting for human approval."""

    @abstractmethod
    async def get_node_runs(self, run_id: str) -> List[NodeRun]:
        """Get all node runs for a workflow run."""

    @abstractmethod
    async def stream_events(self, run_id: str) -> AsyncIterator[Dict[str, Any]]:
        """Stream real-time events for a workflow run (SSE-like)."""

    @abstractmethod
    async def shutdown(self) -> None:
        """Graceful shutdown — flush state, close DB."""
```

**Step 2: Commit**

```bash
git add plugins/workflows/engine_interface.py
git commit -m "feat(workflows): define engine interface contract"
```

---

## Phase 2: Core Engine — Port from TypeScript

This is the bulk of the work. Each task corresponds to one module from the TypeScript engine.

### Task 4: SQLite database layer

**Objective:** Port `db/client.ts` and `db/migrate.ts` to Python. Same DB schema, same file location (`~/.hermes/switchui-workflows.db`), same lock semantics.

**Files:**
- Create: `plugins/workflows/db.py`

**Step 1: Write failing test**

```python
# tests/test_workflow_db.py
import tempfile, os
from pathlib import Path
from plugins.workflows.db import WorkflowDb

def test_db_creates_and_migrates():
    with tempfile.TemporaryDirectory() as tmp:
        db_path = os.path.join(tmp, "test-workflows.db")
        db = WorkflowDb(db_path)
        db.initialize()
        # Verify tables exist
        tables = db.conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
        table_names = {t[0] for t in tables}
        assert "workflow_runs" in table_names
        assert "node_runs" in table_names
        db.close()
```

**Step 2: Implement db.py**

Port the schema from `src/server/workflow-engine/db/migrate.ts`. Tables:
- `workflow_definitions` — name, description, yaml_path, parsed_at
- `workflow_runs` — id, workflow_name, phase, args, started_at, completed_at, error
- `node_runs` — id, workflow_run_id, dag_node_id, node_type, status, assigned_agent, started_at, completed_at, output, error
- `task_events` — event_id, workflow_run_id, node_run_id, event_type, payload, timestamp

Use `sqlite3` stdlib module (matching Hermes Agent's SQLite usage in `hermes_state.py`). WAL mode for concurrent reads.

**Step 3: Run test**

Run: `pytest tests/test_workflow_db.py -v`
Expected: PASS

**Step 4: Commit**

```bash
git add plugins/workflows/db.py tests/test_workflow_db.py
git commit -m "feat(workflows): SQLite database layer with migrations"
```

---

### Task 5: YAML workflow discovery and parsing

**Objective:** Port `discovery/loader.ts`, `discovery/workflow-discovery.ts`, and `schemas/` to Python. Parse YAML workflow definitions into `WorkflowDefinition` objects.

**Files:**
- Create: `plugins/workflows/discovery.py`
- Create: `plugins/workflows/schemas.py`

**Step 1: Write failing test**

```python
# tests/test_workflow_discovery.py
import tempfile, os
from plugins.workflows.discovery import WorkflowDiscovery

def test_discovers_yaml_workflows():
    with tempfile.TemporaryDirectory() as tmp:
        workflows_dir = os.path.join(tmp, "workflows")
        os.makedirs(workflows_dir)
        with open(os.path.join(workflows_dir, "test-flow.yaml"), "w") as f:
            f.write("""
name: test-flow
description: A test workflow
nodes:
  - id: step1
    type: bash
    command: echo hello
  - id: step2
    type: prompt
    prompt: Say hello
    depends_on: [step1]
""")
        disc = WorkflowDiscovery(workflows_dir)
        workflows = disc.discover()
        assert len(workflows) == 1
        assert workflows[0].name == "test-flow"
        assert len(workflows[0].nodes) == 2
```

**Step 2: Implement discovery.py and schemas.py**

Port the Zod schemas from `src/server/workflow-engine/schemas/` to Python dataclasses/pydantic models. Node types: prompt, bash, script, loop, approval, cancel, command, subgraph. Each node has `id`, `depends_on`, `type`, and type-specific fields.

Discovery scans:
1. `~/.hermes/workflows/` (user workflows)
2. `plugins/workflows/defaults/` (bundled workflows)
3. Optional: `.hermes/workflows/` (project workflows, gated by env var)

**Step 3: Run test**

Run: `pytest tests/test_workflow_discovery.py -v`
Expected: PASS

**Step 4: Commit**

```bash
git add plugins/workflows/discovery.py plugins/workflows/schemas.py tests/test_workflow_discovery.py
git commit -m "feat(workflows): YAML workflow discovery and schema parsing"
```

---

### Task 6: DAG executor

**Objective:** Port `core/dag-executor.ts` to Python. Topological sort, parallel layer execution, node type dispatch.

**Files:**
- Create: `plugins/workflows/dag_executor.py`

**Step 1: Write failing test**

```python
# tests/test_dag_executor.py
from plugins.workflows.dag_executor import DagExecutor, DagNode, NodeKind

def test_topological_sort_linear():
    nodes = [
        DagNode(id="a", kind=NodeKind.BASH, config={"command": "echo a"}, depends_on=[]),
        DagNode(id="b", kind=NodeKind.BASH, config={"command": "echo b"}, depends_on=["a"]),
        DagNode(id="c", kind=NodeKind.BASH, config={"command": "echo c"}, depends_on=["b"]),
    ]
    executor = DagExecutor(nodes)
    layers = executor.compute_layers()
    assert len(layers) == 3
    assert [n.id for n in layers[0]] == ["a"]
    assert [n.id for n in layers[1]] == ["b"]
    assert [n.id for n in layers[2]] == ["c"]

def test_topological_sort_parallel():
    nodes = [
        DagNode(id="a", kind=NodeKind.BASH, config={"command": "echo a"}, depends_on=[]),
        DagNode(id="b1", kind=NodeKind.BASH, config={"command": "echo b1"}, depends_on=["a"]),
        DagNode(id="b2", kind=NodeKind.BASH, config={"command": "echo b2"}, depends_on=["a"]),
        DagNode(id="c", kind=NodeKind.BASH, config={"command": "echo c"}, depends_on=["b1", "b2"]),
    ]
    executor = DagExecutor(nodes)
    layers = executor.compute_layers()
    assert len(layers) == 3
    assert [n.id for n in layers[0]] == ["a"]
    assert set(n.id for n in layers[1]) == {"b1", "b2"}
    assert [n.id for n in layers[2]] == ["c"]

def test_cycle_detection():
    nodes = [
        DagNode(id="a", kind=NodeKind.BASH, config={}, depends_on=["b"]),
        DagNode(id="b", kind=NodeKind.BASH, config={}, depends_on=["a"]),
    ]
    executor = DagExecutor(nodes)
    try:
        executor.compute_layers()
        assert False, "Should have raised"
    except ValueError as e:
        assert "cycle" in str(e).lower()
```

**Step 2: Implement dag_executor.py**

Port Kahn's algorithm from `core/dag-executor.ts`. Key behaviors:
- Compute topological layers from `depends_on` arrays
- Detect cycles and raise `ValueError`
- Layer 0 = nodes with no dependencies
- Layer N = nodes depending only on layers 0..N-1
- Nodes in same layer are independent and can run in parallel

**Step 3: Run test**

Run: `pytest tests/test_dag_executor.py -v`
Expected: 3 passed

**Step 4: Commit**

```bash
git add plugins/workflows/dag_executor.py tests/test_dag_executor.py
git commit -m "feat(workflows): DAG executor with topological sort and cycle detection"
```

---

### Task 7: Node type executors

**Objective:** Implement execution logic for each node type (bash, prompt, script, loop, approval, cancel, command, subgraph).

**Files:**
- Create: `plugins/workflows/node_executors.py`

**Step 1: Write failing tests per node type**

```python
# tests/test_node_executors.py
import asyncio
from plugins.workflows.node_executors import BashExecutor, PromptExecutor, ApprovalExecutor

async def test_bash_node():
    result = await BashExecutor.execute({"command": "echo hello"})
    assert result["exit_code"] == 0
    assert "hello" in result["stdout"]

async def test_approval_node_waits():
    # Approval nodes should return status=waiting_approval
    result = await ApprovalExecutor.execute({"message": "Continue?"})
    assert result["status"] == "waiting_approval"
```

**Step 2: Implement node executors**

Each node type is a class with an async `execute(config, context)` method:
- **BashExecutor** — `asyncio.create_subprocess_exec`, capture stdout/stderr, return exit code + output
- **PromptExecutor** — Call the active AI provider via `ctx.llm` (host-owned LLM from PluginContext). Streaming support via event emitter.
- **ScriptExecutor** — Run inline Python/TypeScript via subprocess (matching Archon's bun/uv runtime pattern)
- **LoopExecutor** — Iterative AI calls with stop conditions (ALL_TASKS_COMPLETE, TEST_PASS, max_iterations)
- **ApprovalExecutor** — Return `waiting_approval` status; the approve API route resumes execution
- **CancelExecutor** — Mark the run as cancelled
- **CommandExecutor** — Load a markdown command file and execute as a prompt
- **SubgraphExecutor** — Recursively invoke the engine for a nested workflow

**Step 3: Run tests**

Run: `pytest tests/test_node_executors.py -v`
Expected: PASS

**Step 4: Commit**

```bash
git add plugins/workflows/node_executors.py tests/test_node_executors.py
git commit -m "feat(workflows): node type executors (bash, prompt, script, loop, approval, cancel, command, subgraph)"
```

---

### Task 8: Workflow runner — orchestration layer

**Objective:** Port `runtime/runner.ts` and `core/executor.ts` to Python. Tie together DAG executor, node executors, DB state, and event emission.

**Files:**
- Create: `plugins/workflows/runner.py`
- Create: `plugins/workflows/emitter.py`

**Step 1: Write integration test**

```python
# tests/test_workflow_runner.py
import asyncio, tempfile, os
from plugins.workflows.db import WorkflowDb
from plugins.workflows.discovery import WorkflowDiscovery
from plugins.workflows.runner import WorkflowRunner

async def test_run_simple_workflow():
    with tempfile.TemporaryDirectory() as tmp:
        db = WorkflowDb(os.path.join(tmp, "test.db"))
        db.initialize()

        # Create a simple 2-step workflow
        workflows_dir = os.path.join(tmp, "workflows")
        os.makedirs(workflows_dir)
        with open(os.path.join(workflows_dir, "echo.yaml"), "w") as f:
            f.write("""
name: echo
nodes:
  - id: step1
    type: bash
    command: echo hello
  - id: step2
    type: bash
    command: echo world
    depends_on: [step1]
""")
        disc = WorkflowDiscovery(workflows_dir)
        runner = WorkflowRunner(db, disc)

        run = await runner.launch("echo")
        assert run.phase == "completed"
        nodes = db.get_node_runs(run.id)
        assert len(nodes) == 2
        assert all(n.status == "completed" for n in nodes)
```

**Step 2: Implement runner.py**

- `launch(workflow_name, args)` — Parse workflow, create DB run record, compute DAG layers, execute layer-by-layer
- For each layer: run independent nodes concurrently via `asyncio.gather(*[execute_node(n) for n in layer])`
- Update node_runs status in DB after each node completes
- On failure: mark remaining nodes as skipped, set run phase to FAILED
- Emit events via emitter.py for SSE streaming

**Step 3: Implement emitter.py**

Simple event emitter using `asyncio.Queue`. Events: `run_started`, `node_started`, `node_completed`, `node_failed`, `run_completed`, `run_failed`, `approval_requested`.

**Step 4: Run test**

Run: `pytest tests/test_workflow_runner.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add plugins/workflows/runner.py plugins/workflows/emitter.py tests/test_workflow_runner.py
git commit -m "feat(workflows): workflow runner with layer-by-layer DAG execution"
```

---

### Task 9: Implement the WorkflowEngine class

**Objective:** Wire everything together into the `WorkflowEngine` class that implements the interface from Task 3.

**Files:**
- Create: `plugins/workflows/engine.py`
- Modify: `plugins/workflows/__init__.py` — replace stub handlers

**Step 1: Implement engine.py**

```python
"""Workflow engine — lazy-initialized singleton.

All plugin API routes and tool handlers delegate to this module.
"""
from __future__ import annotations
from typing import Optional
from .engine_interface import WorkflowEngine as IEngine
from .db import WorkflowDb
from .discovery import WorkflowDiscovery
from .runner import WorkflowRunner

class WorkflowEngine(IEngine):
    def __init__(self):
        self._db: Optional[WorkflowDb] = None
        self._runner: Optional[WorkflowRunner] = None

    def _ensure_init(self):
        if self._db is not None:
            return
        self._db = WorkflowDb()
        self._db.initialize()
        disc = WorkflowDiscovery()
        self._runner = WorkflowRunner(self._db, disc)

    async def discover_workflows(self): ...
    async def get_workflow(self, name): ...
    async def launch_run(self, workflow_name, args=None): ...
    async def get_run(self, run_id): ...
    async def list_runs(self, limit=50): ...
    async def cancel_run(self, run_id): ...
    async def approve_node(self, run_id, node_id, response=None): ...
    async def get_node_runs(self, run_id): ...
    async def stream_events(self, run_id): ...
    async def shutdown(self): ...

# Module-level singleton
_engine: Optional[WorkflowEngine] = None

def get_engine() -> WorkflowEngine:
    global _engine
    if _engine is None:
        _engine = WorkflowEngine()
    return _engine
```

**Step 2: Update __init__.py tool handlers**

Replace the stub handlers with calls to `get_engine()`.

**Step 3: Commit**

```bash
git add plugins/workflows/engine.py
git commit -m "feat(workflows): wire engine, DB, discovery, and runner together"
```

---

## Phase 3: Plugin API Routes — Full Implementation

### Task 10: Implement all API routes

**Objective:** Replace the skeleton routes in `plugin_api.py` with real engine-backed routes matching the current Switch UI API surface.

**Files:**
- Modify: `plugins/workflows/dashboard/plugin_api.py`

**Step 1: Implement routes**

Current Switch UI routes to mirror:

| Switch UI Route | Plugin API Route | Method |
|---|---|---|
| `/api/workflow-definitions` | `/api/plugins/workflows/definitions` | GET |
| `/api/workflow-definitions/:id` | `/api/plugins/workflows/definitions/{name}` | GET |
| `/api/workflow-definitions/:id/parsed` | `/api/plugins/workflows/definitions/{name}/parsed` | GET |
| `/api/workflow-runs` | `/api/plugins/workflows/runs` | GET, POST |
| `/api/workflow-runs/:id` | `/api/plugins/workflows/runs/{run_id}` | GET |
| `/api/workflow-runs/:id/approve` | `/api/plugins/workflows/runs/{run_id}/approve` | POST |
| `/api/workflow-events` | `/api/plugins/workflows/events` | GET (SSE) |

**Step 2: Verify with curl**

```bash
hermes dashboard
curl http://localhost:9119/api/plugins/workflows/definitions
curl -X POST http://localhost:9119/api/plugins/workflows/runs -d '{"workflow": "echo"}'
```

**Step 3: Commit**

```bash
git add plugins/workflows/dashboard/plugin_api.py
git commit -m "feat(workflows): full plugin API routes mirroring Switch UI surface"
```

---

## Phase 4: Switch UI Frontend Migration

### Task 11: Add Switch UI proxy routes to plugin API

**Objective:** Add proxy routes in Switch UI that forward to the Hermes Agent plugin API. This lets the frontend keep its existing route structure while the backend moves to the plugin.

**Files:**
- Modify: `src/routes/api/workflow-definitions.ts`
- Modify: `src/routes/api/workflow-runs.ts`
- Modify: `src/routes/api/workflow-runs.$runId.ts`
- Modify: `src/routes/api/workflow-runs.$runId.approve.ts`
- Modify: `src/routes/api/workflow-definitions.$id.ts`
- Modify: `src/routes/api/workflow-definitions.$id.parsed.ts`
- Modify: `src/routes/api/workflow-events.ts`
- Modify: `src/routes/api/conductor/workers.ts`

**Step 1:** For each route file, replace direct `workflow-engine` imports with HTTP calls to `HERMES_API_URL/api/plugins/workflows/*`. Use the existing `hermes-api.ts` client or `fetch` with auth headers.

**Step 2:** Remove `src/server/workflow-engine/` from Switch UI (or keep as dead code behind a feature flag during migration).

**Step 3:** Verify the workflow editor and conductor still work in the browser.

**Step 4: Commit**

```bash
git commit -am "refactor: switch workflow routes from local engine to Hermes plugin API"
```

---

### Task 12: Remove tsconfig aliases and stubs

**Objective:** Clean up the `@archon/*` path aliases and stubs from Switch UI since the engine no longer runs in-process.

**Files:**
- Modify: `tsconfig.json` — remove `@archon/*` paths
- Delete: `src/server/workflow-engine/` (entire directory)
- Modify: `src/server/operations-store.ts` — remove workflow-engine imports
- Modify: `src/server/conductor-store.ts` — remove workflow-engine imports

**Step 1:** Remove tsconfig paths.

**Step 2:** Delete workflow-engine directory.

**Step 3:** Update operations-store and conductor-store to use HTTP calls to plugin API.

**Step 4:** Run `pnpm build` — must pass with zero TS errors.

**Step 5:** Commit

```bash
git commit -am "refactor: remove in-process workflow engine, fully migrated to plugin"
```

---

## Phase 5: Cron Triggers and Dispatcher Integration

### Task 13: Cron trigger poller

**Objective:** Port `cron/` from the TypeScript engine. Allow workflows to be triggered on a schedule.

**Files:**
- Create: `plugins/workflows/cron.py`

**Step 1:** Implement a cron poller that reads `trigger.cron` fields from workflow definitions and schedules runs via APScheduler or a simple sleep-loop (matching Hermes Agent's existing cron system).

**Step 2:** Hook into the plugin's `register()` to start the poller.

**Step 3:** Commit

```bash
git commit -m "feat(workflows): cron trigger poller for scheduled workflows"
```

---

### Task 14: Kanban dispatcher integration

**Objective:** Port `dispatcher/` from the TypeScript engine. Allow workflow runs to create Kanban tasks and dispatch workers.

**Files:**
- Create: `plugins/workflows/dispatcher.py`

**Step 1:** Use `hermes_cli.kanban_db` (same as the Kanban plugin) to create tasks for workflow nodes. Workers pick up tasks and report completion back.

**Step 2:** Commit

```bash
git commit -m "feat(workflows): Kanban dispatcher integration for worker-based execution"
```

---

## Phase 6: Bundled Defaults and Polish

### Task 15: Port bundled default workflows

**Objective:** Port the YAML workflow files from `defaults/bundled-defaults.generated.ts` to actual YAML files in `plugins/workflows/defaults/`.

**Files:**
- Create: `plugins/workflows/defaults/*.yaml` — one per built-in workflow

**Step 1:** Extract the workflow definitions from the generated TypeScript file and write each as a standalone YAML file.

**Step 2:** Verify discovery picks them up.

**Step 3:** Commit

```bash
git commit -m "feat(workflows): bundled default workflow definitions"
```

---

### Task 16: Documentation and enablement guide

**Objective:** Write plugin documentation and update the docs manifest.

**Files:**
- Create: `plugins/workflows/README.md`
- Modify: `docs/plans/workflow-hermes-plugin.md` — mark as complete

**Step 1:** Write README covering installation, enabling, YAML syntax, node types, and API reference.

**Step 2:** Update the Switch UI docs to reference the plugin as the backend.

**Step 3:** Commit

```bash
git commit -m "docs(workflows): plugin README and enablement guide"
```

---

## Summary

| Phase | Tasks | Effort | Dependencies |
|---|---|---|---|
| 1. Skeleton & Contract | 1–3 | 1 day | None |
| 2. Core Engine Port | 4–9 | 5–7 days | Phase 1 |
| 3. API Routes | 10 | 1 day | Phase 2 |
| 4. Switch UI Migration | 11–12 | 2 days | Phase 3 |
| 5. Cron & Dispatcher | 13–14 | 2 days | Phase 2 |
| 6. Defaults & Docs | 15–16 | 1 day | Phase 5 |

**Total: ~12–14 days of focused work across 16 tasks.**

Phases 1–3 can ship as a standalone plugin without touching Switch UI. Phase 4 is the migration cut-over. Phases 5–6 are additive.

The critical path is Phase 2 (engine port). The DAG executor (Task 6) and node executors (Task 7) are the hardest parts — everything else is wiring.
