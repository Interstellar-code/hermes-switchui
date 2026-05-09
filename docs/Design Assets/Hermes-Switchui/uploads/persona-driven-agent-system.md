# Persona-Driven Agent System Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a unified persona-driven agent system in Hermes Switch UI that uses SQLite as the control plane, markdown/YAML persona files as the authoring source, Hermes profiles as durable runtime homes, and existing Hermes dashboard/runtime APIs where available.

**Architecture:** Switch UI owns the registry and orchestration layer. Personas remain file-authored markdown with frontmatter YAML and are indexed into SQLite. Durable agents are backed by Hermes profile directories with generated `SOUL.md` and profile config. Switch UI server routes first leverage Hermes dashboard APIs where available, and otherwise perform local SQLite/file operations behind a stable UI-facing API.

**Tech Stack:** TanStack Start, React, server routes under `src/routes/api/`, server modules under `src/server/`, SQLite, markdown/frontmatter parsing, Hermes profile directories under `~/.hermes/profiles/`.

---

## Product Terminology

Use these terms consistently in the UI and docs:

- **Persona** — reusable steering template authored as markdown + frontmatter YAML
- **Agent** — durable registered worker backed by a Hermes profile
- **Run** — execution instance of an agent or persona
- **Subagent** — ephemeral spawned runtime worker

Internal implementation term only:

- **Profile** — Hermes persistence primitive for a durable agent

Do **not** expose "profile" as the primary UI concept except in advanced/debug surfaces.

---

## Scope and Constraints

### In scope

- Persona library indexed from markdown/frontmatter files into SQLite
- Durable agent registration from personas
- Generated `SOUL.md` per durable agent
- SQLite registry for personas, agents, and runs
- Switch UI server API routes as the stable control plane
- Prefer Hermes dashboard APIs when they already expose useful reads/actions
- File writes for missing provisioning/admin gaps
- Migration path away from Operations / Conductor / Swarm toward one unified system

### Out of scope for this phase

- Large new Hermes Agent backend feature work
- New first-class Hermes core APIs for persona/agent registration
- Full runtime orchestration replacement of every existing feature on day one
- Rich in-browser markdown persona editing
- Deep multi-agent mission planner UX beyond initial registry/run surfaces

### Explicit constraints

- SQLite is the registry/control plane
- Persona files remain markdown + YAML on disk
- Browser client never writes Hermes files directly
- Switch UI server routes decide whether to use Hermes dashboard APIs or local file/DB operations
- Gateway/runtime APIs are action-capable but not the primary admin control plane

---

## Source-of-Truth Model

### Persona source of truth

- Persona files on disk are the authoring source of truth
- SQLite stores parsed/indexed metadata plus cached raw content for fast querying

### Agent source of truth

- SQLite is the source of truth for agent registration metadata
- Hermes profile directories are the runtime persistence implementation

### Runtime source of truth

- Hermes sessions/runtime events are the execution truth
- Switch UI may cache run metadata in SQLite for queryability and linkage

### UI contract

- The browser talks only to Switch UI API routes
- Switch UI API routes may:
  - proxy to Hermes dashboard APIs
  - read/write SQLite
  - read/write local Hermes profile files
  - invoke runtime actions where needed

---

## Directory and Storage Assumptions

### Persona library

Assume persona files live in a configurable directory on disk and remain markdown files with YAML frontmatter.

Suggested config field in Switch UI server config/module:

- `personaRoot: /absolute/path/to/persona-library`

If a prior OpenClaw persona library path already exists, adopt it rather than copying files.

### SQLite database

Use a dedicated SQLite database for this system.

Suggested path:

- `~/.hermes/agents.db`

This avoids coupling to Kanban storage while still living in the Hermes home.

### Hermes profile directories

Durable agents map to Hermes profiles:

- `~/.hermes/profiles/<profile_name>/`

Generated/managed files include:

- `SOUL.md`
- `config.yaml`
- optional `agent.json` metadata file if useful
- `sessions/`
- `skills/`

---

## Persona File Format

Personas remain markdown with frontmatter YAML.

Example shape:

```md
---
id: neo-technical
name: Neo
role: Technical Specialist
category: engineering
tags:
  - coding
  - infrastructure
  - devops
model_hint: claude-sonnet-4
provider_hint: anthropic
tool_preferences:
  - terminal
  - file
  - web
delegation_style: orchestrator
description: Technical execution specialist for coding, infra, debugging, and systems.
---

You are Neo, a deeply technical specialist...

Focus on:
- coding
- infra
- debugging
- architecture

Communication style:
- direct
- technical
- concise
```

### Required parsing behavior

- frontmatter must be parsed into structured metadata
- body markdown must be preserved as authored
- unknown frontmatter keys must be preserved in a JSON blob rather than discarded
- invalid persona files must be reported with actionable parse errors

---

## Data Model

### Table: `personas`

Purpose: indexed registry of persona source files.

Fields:

- `id` TEXT PRIMARY KEY
- `slug` TEXT UNIQUE NOT NULL
- `name` TEXT NOT NULL
- `role` TEXT
- `category` TEXT
- `description` TEXT
- `source_path` TEXT NOT NULL
- `frontmatter_json` TEXT NOT NULL
- `body_markdown` TEXT NOT NULL
- `tags_json` TEXT
- `tool_preferences_json` TEXT
- `model_hint` TEXT
- `provider_hint` TEXT
- `enabled` INTEGER NOT NULL DEFAULT 1
- `checksum` TEXT
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL
- `last_indexed_at` TEXT NOT NULL

Indexes:

- unique index on `slug`
- index on `category`
- index on `enabled`

### Table: `agents`

Purpose: durable registered agents backed by Hermes profiles.

Fields:

- `id` TEXT PRIMARY KEY
- `name` TEXT NOT NULL
- `slug` TEXT UNIQUE NOT NULL
- `persona_id` TEXT REFERENCES personas(id)
- `profile_name` TEXT UNIQUE NOT NULL
- `description` TEXT
- `model` TEXT
- `provider` TEXT
- `toolsets_json` TEXT
- `delegation_mode` TEXT
- `orchestrator_enabled` INTEGER NOT NULL DEFAULT 0
- `max_spawn_depth` INTEGER
- `soul_strategy` TEXT NOT NULL DEFAULT 'generated'
- `persona_override_markdown` TEXT
- `status` TEXT NOT NULL DEFAULT 'active'
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

Indexes:

- unique index on `slug`
- unique index on `profile_name`
- index on `persona_id`
- index on `status`

### Table: `agent_files`

Purpose: track generated profile artifacts and detect drift.

Fields:

- `id` TEXT PRIMARY KEY
- `agent_id` TEXT NOT NULL REFERENCES agents(id)
- `file_type` TEXT NOT NULL
- `path` TEXT NOT NULL
- `checksum` TEXT
- `updated_at` TEXT NOT NULL

### Table: `agent_runs`

Purpose: link runs, sessions, runtime modes, and UI surfaces.

Fields:

- `id` TEXT PRIMARY KEY
- `agent_id` TEXT NULL REFERENCES agents(id)
- `persona_id` TEXT NULL REFERENCES personas(id)
- `session_id` TEXT
- `parent_session_id` TEXT
- `run_type` TEXT NOT NULL
- `status` TEXT NOT NULL
- `goal` TEXT
- `toolsets_json` TEXT
- `model` TEXT
- `provider` TEXT
- `started_at` TEXT NOT NULL
- `ended_at` TEXT

Expected `run_type` values:

- `durable`
- `ephemeral`
- `subagent`

### Optional table: `persona_import_jobs`

Use if reindexing/auditing needs job history.

---

## SOUL Generation Strategy

### Rule

Generated `SOUL.md` is a compiled artifact.

- persona file remains upstream authoring source
- agent-level overrides may exist independently
- regenerating SOUL must not mutate persona source files

### Composition order

Build generated SOUL using:

1. base template/header
2. durable agent identity metadata
3. persona source reference
4. persona body markdown
5. optional agent-specific overrides
6. optional operational notes/settings

### Example generated shape

```md
# SOUL.md — Neo

You are Neo, a technical specialist operating inside Hermes.

## Identity
- Name: Neo
- Role: Technical Specialist
- Platform: Hermes
- Department: Engineering
- Principal: Rohit Sharma

## Persona Source
Derived from persona: neo-technical

## Core Behavior
[persona markdown body inserted here]

## Agent Overrides
[optional per-agent overrides]
```

### Drift rule

If `SOUL.md` is manually edited on disk after generation:

- do not silently overwrite it
- show a drift flag in UI
- require explicit regenerate/force action

---

## Runtime Model

### Durable agent run

Used when launching a registered agent.

Mechanism:

- resolve agent from SQLite
- resolve profile name/path
- invoke Hermes runtime under that profile identity
- capture session linkage if available
- store run metadata in `agent_runs`

### Ephemeral persona run

Used when running a persona without durable registration.

Mechanism:

- resolve persona from SQLite/file
- compose temporary prompt from persona + goal + context
- invoke runtime without creating a profile
- capture run metadata in `agent_runs`

### Persona-seeded subagent run

Used when a parent run wants a specialist worker on the fly.

Mechanism:

- resolve persona
- build child prompt from persona + runtime goal + context
- launch via runtime/delegation mechanism
- do not create a profile
- link child run/session via `parent_session_id` where possible

---

## API Strategy

### Principle

Switch UI server routes are the stable application layer.

They should:

- use Hermes dashboard APIs where available and appropriate
- otherwise perform local DB/file operations
- hide implementation differences from the frontend

### Use Hermes dashboard/API where available for:

- reading profiles or agent-adjacent status if already exposed
- reading sessions/runs/status/capabilities
- invoking existing runtime actions already supported cleanly
- capability probing

### Use Switch UI server routes for:

- persona indexing and query APIs
- durable agent creation/update/delete
- profile directory provisioning when Hermes exposes no suitable API
- SOUL generation/regeneration
- config generation/patching
- drift detection
- unified run metadata normalization

### Do not use gateway/runtime as the primary admin plane

Gateway/runtime APIs are useful for:

- chat/session actions
- streaming
- runtime interaction
- possibly launching work

But they are not the primary mechanism for:

- persona registry management
- durable agent registration
- profile file lifecycle administration

---

## Proposed Switch UI API Surface

These are Switch UI-owned routes unless Hermes already exposes the exact operation cleanly.

### Personas

- `GET /api/personas`
- `GET /api/personas/:id`
- `POST /api/personas/reindex`
- `GET /api/personas/categories`
- `GET /api/personas/tags`

### Agents

- `GET /api/agents`
- `GET /api/agents/:id`
- `POST /api/agents`
- `PATCH /api/agents/:id`
- `DELETE /api/agents/:id`
- `POST /api/agents/:id/sync`
- `POST /api/agents/:id/regenerate-soul`

### Runs

- `GET /api/runs`
- `GET /api/runs/:id`
- `POST /api/agents/:id/run`
- `POST /api/personas/:id/run`
- `GET /api/runs/tree/:sessionId`

### Runtime / Subagents

- `GET /api/subagents/active`
- `POST /api/subagents/spawn`
- `POST /api/subagents/:id/interrupt`

### Sync / Reconciliation

- `POST /api/agents/sync-profiles`
- `POST /api/personas/reconcile`

All responses should return normalized UI-facing objects independent of whether the underlying action used Hermes APIs or local file/DB operations.

---

## UI Information Architecture

### Personas surface

Purpose:

- browse and inspect persona library
- search/filter by category/tags
- create durable agent from persona
- run persona instantly

Minimum capabilities:

- list view
- detail drawer/page
- raw markdown preview
- parsed metadata panel
- actions: `Create Agent`, `Run Instantly`

### Agents surface

Purpose:

- durable agent registry
- operational controls for registered agents

Minimum capabilities:

- list of agents
- source persona link
- model/provider/toolsets summary
- drift/sync status
- actions: `Run`, `Edit`, `Regenerate SOUL`, `Sync`, `Delete`

### Runs surface

Purpose:

- operational visibility across durable, ephemeral, and child runs

Minimum capabilities:

- run list/status
- session linkage
- parent/child tree where available
- interrupt controls where feasible

### Unified IA recommendation

One consolidated `/agents` feature should replace the current fragmentation over time.

Suggested tabs:

- `Personas`
- `Agents`
- `Runs`

---

## Mapping From Existing Concepts

### Operations → Agents

Replace Operations durable-agent management with:

- agent registry
- create agent from persona
- edit durable agent

### Conductor → Runs / Orchestration

Replace Conductor mission launching with:

- run durable agent
- run persona instantly
- later: orchestration templates

### Swarm → Runtime graph

Replace Swarm worker-centric view with:

- run hierarchy
- subagent tree
- child execution visibility

Do **not** build new long-lived features on top of the existing Operations/Conductor/Swarm page model.

---

## Reconciliation and Drift Handling

Because this design intentionally mixes file-authored personas, SQLite registry state, and Hermes profile directories, drift detection is mandatory.

### Persona reindex behavior

On reindex:

- scan persona root recursively for markdown files
- parse frontmatter and markdown body
- compute checksum
- upsert `personas`
- mark missing files as disabled or missing rather than silently deleting
- report invalid files with parse errors

### Agent/profile sync behavior

For each durable agent:

- verify profile dir exists
- verify generated files exist
- compare checksums where tracked
- flag drift if runtime files diverge from expected generated artifacts

### Overwrite policy

- never silently overwrite manually edited `SOUL.md`
- never silently destroy unknown files in profile dir
- allow explicit regenerate or force sync actions from UI

---

## Security and Safety Rules

- Browser client must never write directly to `~/.hermes/profiles/*`
- API routes must redact secrets when reading or patching config
- Never expose raw API keys in agent/profile responses
- File writes must be constrained to allowed roots
- Persona file parsing must treat frontmatter/body as untrusted content
- Profile creation must sanitize `profile_name` and file paths

---

## Implementation Tasks

### Task 1: Create the plan file and lock terminology

**Objective:** Establish the implementation plan and terminology baseline in-repo so all follow-up work uses consistent language.

**Files:**
- Create: `docs/plans/persona-driven-agent-system.md`

**Step 1: Save this plan in the repo**

This document is the plan artifact.

**Step 2: Confirm terminology with Rohit**

Use:
- Persona
- Agent
- Run
- Subagent

Expected result: no new UI work uses "profile" as the primary user-facing label.

**Step 3: Commit**

```bash
git add docs/plans/persona-driven-agent-system.md
git commit -m "docs: add persona-driven agent system plan"
```

---

### Task 2: Add SQLite foundation for personas/agents/runs

**Objective:** Create the SQLite database layer and schema helpers for persona/agent/run metadata.

**Files:**
- Create: `src/server/agents-db.ts`
- Create: `src/server/agent-schema.ts` or equivalent helper module
- Test: `tests/server/agents-db.test.ts` or repo-appropriate server test path

**Step 1: Write failing test for schema initialization**

Test should verify:
- DB initializes successfully
- required tables exist
- rerunning init is idempotent

**Step 2: Run the test to verify failure**

Run repo-appropriate test command targeting the new test.
Expected: failure because DB init layer does not exist.

**Step 3: Implement the DB layer**

Responsibilities:
- resolve DB path under `~/.hermes/agents.db`
- create tables if absent
- expose typed helpers for persona/agent/run CRUD
- serialize JSON fields consistently

**Step 4: Run the test to verify pass**

Expected: schema initializes and is idempotent.

**Step 5: Commit**

```bash
git add src/server/agents-db.ts tests/server/agents-db.test.ts
git commit -m "feat: add sqlite foundation for persona agent registry"
```

---

### Task 3: Build persona file parser and indexer

**Objective:** Parse markdown/frontmatter persona files from disk and index them into SQLite.

**Files:**
- Create: `src/server/persona-registry.ts`
- Create: `src/server/persona-parser.ts`
- Test: `tests/server/persona-registry.test.ts`

**Step 1: Write failing tests for parsing and reindex**

Test cases:
- valid persona file parses correctly
- unknown frontmatter keys preserved in JSON
- invalid frontmatter returns useful error
- reindex upserts existing persona
- missing file marks persona missing/disabled rather than hard deleting

**Step 2: Run tests to verify failure**

Expected: parser/indexer not yet implemented.

**Step 3: Implement parser and reindexer**

Responsibilities:
- recursive scan under configured persona root
- parse frontmatter and body
- compute checksum
- persist parsed rows into `personas`
- return summary counts: added/updated/invalid/missing

**Step 4: Run tests to verify pass**

Expected: all persona indexer tests pass.

**Step 5: Commit**

```bash
git add src/server/persona-registry.ts src/server/persona-parser.ts tests/server/persona-registry.test.ts
git commit -m "feat: add persona markdown indexing pipeline"
```

---

### Task 4: Add persona API routes

**Objective:** Expose the persona library to the UI through Switch UI API routes.

**Files:**
- Create: `src/routes/api/personas/index.ts`
- Create: `src/routes/api/personas/$personaId.ts`
- Create: `src/routes/api/personas/reindex.ts`
- Optionally create: `src/routes/api/personas/categories.ts`
- Optionally create: `src/routes/api/personas/tags.ts`
- Test: route tests if project already has an API-route testing pattern

**Step 1: Write failing tests for persona listing/detail/reindex**

Must verify:
- list returns normalized persona summaries
- detail returns parsed metadata + raw content preview fields
- reindex triggers indexer and returns summary counts

**Step 2: Run tests to verify failure**

Expected: routes absent.

**Step 3: Implement routes**

Rules:
- frontend never reads persona files directly
- route responses must come from normalized server objects
- reindex route must be server-only and safe

**Step 4: Run tests to verify pass**

Expected: persona API behaves consistently.

**Step 5: Commit**

```bash
git add src/routes/api/personas
 git commit -m "feat: add persona registry api routes"
```

---

### Task 5: Add Persona Library UI

**Objective:** Build the first UI surface for browsing and inspecting personas.

**Files:**
- Create: `src/screens/personas/personas-screen.tsx`
- Create route: `src/routes/personas.tsx` or fold into unified `/agents` route depending on current IA choice
- Add supporting components under `src/screens/personas/components/`

**Step 1: Write failing UI test or interaction test if available**

Verify:
- list renders persona cards/rows
- selecting a persona shows details
- actions `Create Agent` and `Run Instantly` are present but can be placeholder-gated initially

**Step 2: Run test to verify failure**

Expected: persona UI absent.

**Step 3: Implement UI**

Minimum fields to show:
- name
- role
- category
- tags
- description
- source path (advanced/debug only)
- raw markdown preview

**Step 4: Run test to verify pass**

Expected: persona browsing works end-to-end against API routes.

**Step 5: Commit**

```bash
git add src/screens/personas src/routes/personas.tsx
git commit -m "feat: add persona library ui"
```

---

### Task 6: Add durable agent registry model and service

**Objective:** Implement server-side agent registration logic backed by SQLite and Hermes profile provisioning.

**Files:**
- Create: `src/server/agent-registry.ts`
- Create: `src/server/agent-profile-writer.ts`
- Create: `src/server/agent-soul-generator.ts`
- Test: `tests/server/agent-registry.test.ts`

**Step 1: Write failing tests for agent creation from persona**

Must verify:
- agent row inserted in SQLite
- profile directory path resolved safely
- `SOUL.md` generated from persona + agent metadata
- `config.yaml` created or patched
- duplicate profile names are rejected cleanly

**Step 2: Run tests to verify failure**

Expected: agent registry/provisioner absent.

**Step 3: Implement registry and file writer**

Responsibilities:
- create agent row
- derive/sanitize `profile_name`
- create profile dir if absent
- write generated `SOUL.md`
- write or patch `config.yaml`
- store generated file metadata/checksums

**Step 4: Run tests to verify pass**

Expected: durable agent registration works locally without browser direct filesystem access.

**Step 5: Commit**

```bash
git add src/server/agent-registry.ts src/server/agent-profile-writer.ts src/server/agent-soul-generator.ts tests/server/agent-registry.test.ts
git commit -m "feat: add durable agent registration from personas"
```

---

### Task 7: Add agent API routes

**Objective:** Expose durable agent registration and management through normalized Switch UI API routes.

**Files:**
- Create: `src/routes/api/agents/index.ts`
- Create: `src/routes/api/agents/$agentId.ts`
- Create: `src/routes/api/agents/$agentId/regenerate-soul.ts`
- Create: `src/routes/api/agents/$agentId/sync.ts`
- Test: route tests as appropriate

**Step 1: Write failing tests for agent CRUD and regenerate**

Verify:
- create agent from persona payload
- list agents
- update editable agent fields
- regenerate SOUL without mutating persona file
- sync detects drift

**Step 2: Run tests to verify failure**

Expected: agent routes absent.

**Step 3: Implement routes**

Important behavior:
- routes may consult Hermes dashboard APIs when useful
- but provisioning must still work locally via file/DB operations when Hermes lacks an API
- responses must redact secrets and normalize implementation detail away

**Step 4: Run tests to verify pass**

Expected: stable API contract for agent management.

**Step 5: Commit**

```bash
git add src/routes/api/agents
git commit -m "feat: add agent management api routes"
```

---

### Task 8: Build Agent Registry UI

**Objective:** Replace the old durable-agent creation mental model with agent registration from personas.

**Files:**
- Create or modify: unified agent screen under `src/screens/agents/`
- Add components for create-agent flow, agent detail, and drift state
- Add/modify route under `src/routes/agents.tsx` or unified replacement route

**Step 1: Write failing UI test for create-agent flow**

Verify:
- user can choose persona
- enter agent name
- set basic model/provider/toolset options
- submit create request
- see new agent in registry

**Step 2: Run test to verify failure**

Expected: UI flow absent.

**Step 3: Implement UI**

Must show:
- source persona
- profile-backed agent identity
- drift/regeneration status
- actions: `Run`, `Edit`, `Regenerate SOUL`, `Delete`

**Step 4: Run test to verify pass**

Expected: durable agent creation works end-to-end from UI.

**Step 5: Commit**

```bash
git add src/screens/agents src/routes/agents.tsx
git commit -m "feat: add persona-driven agent registry ui"
```

---

### Task 9: Add ephemeral persona runs

**Objective:** Allow a persona to be executed instantly without creating a durable agent.

**Files:**
- Create: `src/server/agent-runtime.ts`
- Create: `src/routes/api/personas/$personaId/run.ts`
- Create: `src/routes/api/runs/index.ts`
- Create: `src/routes/api/runs/$runId.ts`
- Test: `tests/server/agent-runtime.test.ts`

**Step 1: Write failing tests for ephemeral run registration**

Verify:
- persona run can be created without profile provisioning
- run metadata is written to SQLite
- session linkage is recorded when available

**Step 2: Run test to verify failure**

Expected: runtime bridge absent.

**Step 3: Implement runtime bridge**

Near-term rule:
- leverage existing Hermes runtime/dashboard/gateway behavior where already available
- do not introduce large new Hermes Agent backend work
- keep the Switch UI bridge thin

**Step 4: Run test to verify pass**

Expected: user can run a persona instantly from the UI.

**Step 5: Commit**

```bash
git add src/server/agent-runtime.ts src/routes/api/personas src/routes/api/runs tests/server/agent-runtime.test.ts
git commit -m "feat: add ephemeral persona run support"
```

---

### Task 10: Add run tree and subagent visibility

**Objective:** Create a unified runtime view that begins replacing the old Swarm/Conductor split.

**Files:**
- Create: `src/routes/api/runs/tree/$sessionId.ts` or equivalent
- Create or extend: `src/screens/runs/runs-screen.tsx`
- Optional: `src/routes/api/subagents/active.ts`

**Step 1: Write failing test for run tree normalization**

Verify:
- parent/child linkage normalizes correctly from available session/run metadata
- durable, ephemeral, and child runs render in a consistent model

**Step 2: Run test to verify failure**

Expected: run tree normalization absent.

**Step 3: Implement normalization + UI**

Display:
- run type
- status
- parent session
- child workers
- interrupt action where feasible

**Step 4: Run test to verify pass**

Expected: runtime hierarchy becomes visible from one place.

**Step 5: Commit**

```bash
git add src/routes/api/runs src/routes/api/subagents src/screens/runs
git commit -m "feat: add unified run and subagent visibility"
```

---

### Task 11: Deprecate old conceptual surfaces in favor of unified Agents IA

**Objective:** Replace Operations / Conductor / Swarm as the primary mental model.

**Files:**
- Modify affected routes/navigation/components under `src/routes/`, `src/components/`, and `src/screens/`
- Update docs where necessary

**Step 1: Write failing test or acceptance checklist for navigation/state**

Verify:
- new canonical entrypoint is the unified Agents area
- legacy pages are clearly deprecated, redirected, or visually subordinate

**Step 2: Implement navigation changes**

Rules:
- no new feature work should deepen the old fragmentation
- preserve compatibility where needed during transition

**Step 3: Run verification**

Expected: one coherent system becomes canonical.

**Step 4: Commit**

```bash
git add src/routes src/components src/screens
git commit -m "refactor: consolidate legacy agent surfaces into unified model"
```

---

## Phase Recommendation

### Recommended immediate delivery

Start with **Phase 1 + Phase 2 only**:

- SQLite foundation
- persona indexing
- persona library UI
- durable agent creation from persona
- generated SOUL + profile provisioning

This creates meaningful value without requiring large Hermes Agent backend changes.

### Follow-up phases

- Phase 3: ephemeral persona runs
- Phase 4: unified runtime visibility
- Phase 5: legacy surface replacement

---

## Acceptance Criteria

### Phase 1 accepted when:

- 150–200 persona markdown files index successfully into SQLite
- personas are searchable/filterable in UI
- raw markdown and parsed metadata are visible
- reindex reports added/updated/invalid/missing counts

### Phase 2 accepted when:

- user can create a durable agent from a persona in UI
- SQLite agent row is written
- Hermes profile directory is created safely
- `SOUL.md` is generated correctly
- `config.yaml` is created/patched safely
- agent appears in registry with drift/sync metadata

### Later phases accepted when:

- ephemeral persona runs work without durable registration
- run/session linkage is visible
- runtime tree replaces Swarm/Conductor fragmentation

---

## Pitfalls to Avoid

- Treating gateway/runtime as the primary admin/control plane
- Letting the browser write Hermes profile files directly
- Conflating personas, agents, and subagents into one model
- Rigidly schema-locking persona markdown instead of preserving raw authored content
- Silently overwriting manually modified `SOUL.md`
- Leaking secrets through config reads or route responses
- Building new major features on top of deprecated Operations/Conductor/Swarm foundations

---

## Final Recommendation

Use Switch UI as the adapter and control plane. Keep persona authoring file-first, management database-first, and runtime Hermes-native. This gives you a differentiated, scalable agent architecture without requiring a large Hermes Agent backend project first.
