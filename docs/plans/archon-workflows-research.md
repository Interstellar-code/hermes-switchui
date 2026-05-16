# Archon Built-In Workflows — Research Catalog

**Source path:** `/Volumes/Ext-nvme/Development/archon/.archon/workflows/defaults/` (20 YAML files).
Workflows reference markdown commands in `/Volumes/Ext-nvme/Development/archon/.archon/commands/defaults/`.

**Schema note:** Nodes do NOT use a `type:` field. Type is inferred from which payload key is present: `command:` (markdown command ref), `prompt:`, `bash:`, `script:`, `loop:`, or `approval:`. Many "command" nodes delegate heavy lifting (bash, prompts, fans-out) into their referenced `.md` files, so node-type counts below understate the real surface area.

**Method:** Each YAML parsed for node `id`, payload-key (→ type), `depends_on` (DAG edges), `provider`, `user_input_prompt`. DAG depth = longest path; max parallelism = widest depth-layer. External tools detected by regex over YAML + referenced command bodies. Env vars = `$VAR` / `${VAR}` references in the same blob.

---

## Workflow Cards

### archon-idea-to-pr
- **File:** `.archon/workflows/defaults/archon-idea-to-pr.yaml`
- **Nodes:** 17 (bash:1, command:16)
- **DAG depth / max parallelism:** 13 / 5
- **Providers:** claude
- **External tools:** gh, git, jq, eslint
- **Env / secrets (14):** `$BASE_BRANCH`, `$ACTUAL`, `$EXPECTED`, `$PR_NUMBER`, `$ARGUMENTS`, `$WORKFLOW_ID`, `$ARTIFACTS_DIR`, `$PLAN_PATH`, `$PR_URL`, `$PR_BASE`, `$PR_HEAD`, `$DOCS_DIR` …
- **Schedule:** (none)
- **Human-in-the-loop:** (none)
- **Output artifacts:** `.archon/commands/`, `docs/PULL_REQUEST_TEMPLATE.md`, `GitHub PR`, `git commit`, `GitHub comment`
- **Behavior:** Full pipeline from raw feature idea to merge-ready PR: builds a comprehensive implementation plan with codebase analysis, sets up a branch and scope guardrails, validates plan freshness, implements with type-checking, runs the validation suite, opens a PR using the repo template, then runs 5 parallel scope-aware review agents, synthesizes/fixes their findings, and finally posts a decision matrix back to GitHub with follow-up recommendations.
- **Port risk:** **High** — Heavy reliance on `gh` CLI, GitHub PR template, scope-limit semantics, and 16 markdown-command dependencies (archon-create-plan, archon-implement-tasks, archon-finalize-pr, code-review-agent, ...). All commands must be ported too.

### archon-plan-to-pr
- **File:** `.archon/workflows/defaults/archon-plan-to-pr.yaml`
- **Nodes:** 16 (bash:1, command:15)
- **DAG depth / max parallelism:** 12 / 5
- **Providers:** claude
- **External tools:** gh, git, jq, eslint
- **Env / secrets (14):** `$ARTIFACTS_DIR`, `$BASE_BRANCH`, `$ACTUAL`, `$EXPECTED`, `$PR_NUMBER`, `$ARGUMENTS`, `$WORKFLOW_ID`, `$PLAN_PATH`, `$PR_URL`, `$PR_BASE`, `$PR_HEAD`, `$DOCS_DIR` …
- **Schedule:** (none)
- **Human-in-the-loop:** (none)
- **Output artifacts:** `.archon/commands/`, `docs/PULL_REQUEST_TEMPLATE.md`, `GitHub PR`, `git commit`, `GitHub comment`
- **Behavior:** Same downstream pipeline as idea-to-pr but starts from an existing plan file (skips plan creation). Reads the plan, sets up branch + scope limits, re-verifies research validity, implements all tasks, runs full validation, opens the PR, then 5 parallel review agents, synthesis/fix, and posts the final summary comment.
- **Port risk:** **High** — Same command-graph + gh dependency as idea-to-pr; needs $ARTIFACTS_DIR plan-file convention.

### archon-fix-github-issue
- **File:** `.archon/workflows/defaults/archon-fix-github-issue.yaml`
- **Nodes:** 22 (prompt:4, bash:3, command:15)
- **DAG depth / max parallelism:** 17 / 5
- **Providers:** claude
- **External tools:** gh, git, npm, pnpm, yarn, jq, cargo
- **Env / secrets (14):** `$ARGUMENTS`, `$ISSUE_NUM`, `$ARTIFACTS_DIR`, `$BASE_BRANCH`, `$PR_NUMBER`, `$PR_URL`, `$ACTUAL`, `$EXPECTED`, `$WORKFLOW_ID`, `$PR_BASE`, `$PR_HEAD`, `$DOCS_DIR` …
- **Schedule:** (none)
- **Human-in-the-loop:** (none)
- **Output artifacts:** `.archon/commands/`, `docs/PULL_REQUEST_TEMPLATE.md`, `GitHub PR`, `git commit`, `GitHub comment`
- **Behavior:** Classifies a GitHub issue (bug vs feature/enhancement), researches context via web + codebase exploration, conditionally routes to investigate (bug) or plan (feature), implements the fix with validation, and opens a draft PR using the repo's PR template. Largest workflow at 22 nodes, depth 17.
- **Port risk:** **High** — Largest workflow (22 nodes, depth 17), needs gh + git + multi-pkg-mgr (npm/pnpm/yarn) + cargo + jq, branching DAG over issue classification, and a draft-PR step keyed to repo PR template.

### archon-feature-development
- **File:** `.archon/workflows/defaults/archon-feature-development.yaml`
- **Nodes:** 3 (bash:1, command:2)
- **DAG depth / max parallelism:** 3 / 1
- **Providers:** claude
- **External tools:** gh, git, npm, pnpm, yarn, jq, curl, pytest, cargo, tsc
- **Env / secrets (10):** `$ARTIFACTS_DIR`, `$BASE_BRANCH`, `$ACTUAL`, `$EXPECTED`, `$PR_NUMBER`, `$ARGUMENTS`, `$SERVER_PID`, `$BRANCH`, `$ISSUE_NUM`, `$PR_URL`
- **Schedule:** (none)
- **Human-in-the-loop:** (none)
- **Output artifacts:** `docs/PULL_REQUEST_TEMPLATE.md`, `GitHub PR`, `git commit`
- **Behavior:** Thin three-node pipeline: read an existing plan, implement it with validation loops, and create a pull request. Designed as a wrapper around `archon-implement-tasks` + `archon-finalize-pr` for the case where planning was already done elsewhere.
- **Port risk:** **Med** — Only 3 nodes, but `archon-implement-tasks` + `archon-finalize-pr` commands carry the complexity (gh + pkg mgrs + tsc + pytest).

### archon-comprehensive-pr-review
- **File:** `.archon/workflows/defaults/archon-comprehensive-pr-review.yaml`
- **Nodes:** 9 (command:9)
- **DAG depth / max parallelism:** 5 / 5
- **Providers:** (neutral / inferred from commands)
- **External tools:** gh, git, jq
- **Env / secrets (8):** `$ARTIFACTS_DIR`, `$ARGUMENTS`, `$PR_NUMBER`, `$PR_BASE`, `$PR_HEAD`, `$DOCS_DIR`, `$BEHIND`, `$HEAD_BRANCH`
- **Schedule:** (none)
- **Human-in-the-loop:** (none)
- **Output artifacts:** `.archon/commands/`, `git commit`, `GitHub comment`
- **Behavior:** Syncs the PR with main (rebases if needed), then fans out 5 specialized review agents in parallel (code review, comment quality, test coverage, docs impact, error handling), synthesizes their findings, auto-fixes CRITICAL/HIGH issues, and posts a comprehensive review comment on the PR. Reports land in `$ARTIFACTS_DIR/../reviews/pr-{number}/`.
- **Port risk:** **Med** — No prompt/bash inline; the work is in 9 command markdowns + 5-way fan-out review. Easy DAG, but porting depends on those command bodies.

### archon-smart-pr-review
- **File:** `.archon/workflows/defaults/archon-smart-pr-review.yaml`
- **Nodes:** 12 (prompt:2, bash:1, command:9)
- **DAG depth / max parallelism:** 7 / 5
- **Providers:** (neutral / inferred from commands)
- **External tools:** gh, git, jq
- **Env / secrets (8):** `$ARGUMENTS`, `$ARTIFACTS_DIR`, `$PR_NUMBER`, `$PR_BASE`, `$PR_HEAD`, `$DOCS_DIR`, `$BEHIND`, `$HEAD_BRANCH`
- **Schedule:** (none)
- **Human-in-the-loop:** (none)
- **Output artifacts:** `.archon/mcp/ntfy.json`, `.archon/commands/`, `docs/mcp-servers.md`, `git commit`, `GitHub comment`
- **Behavior:** Variant of the comprehensive review with a classification step at the front: gathers PR scope, classifies complexity (e.g. typo vs feature), and routes only the relevant review agents (a 3-line typo fix skips test-coverage and docs-impact). Same auto-fix + synthesize tail.
- **Port risk:** **Med** — Needs PR-complexity classifier prompt plus conditional routing on a custom decision JSON shape; otherwise similar to comprehensive.

### archon-validate-pr
- **File:** `.archon/workflows/defaults/archon-validate-pr.yaml`
- **Nodes:** 10 (prompt:1, bash:4, command:5)
- **DAG depth / max parallelism:** 8 / 2
- **Providers:** claude
- **External tools:** gh, git, curl
- **Env / secrets (20):** `$ARTIFACTS_DIR`, `$ARGUMENTS`, `$PR_NUMBER`, `$BACKEND_PORT`, `$FRONTEND_PORT`, `$CANONICAL_REPO`, `$WORKTREE_PATH`, `$FEATURE_BRANCH`, `$PR_HEAD`, `$PR_BASE`, `$PID`, `$PORT` …
- **Schedule:** (none)
- **Human-in-the-loop:** (none)
- **Output artifacts:** `GitHub comment`
- **Behavior:** Reproduce-and-verify validator: fetches PR info, allocates free ports, runs parallel code reviews on main vs feature branch, executes an E2E test on main to reproduce the bug, an E2E test on the feature branch to verify the fix, and emits a final verdict report. Designed for parallel runs (no port collisions).
- **Port risk:** **High** — Spins up dev servers on free ports, runs E2E twice (main + feature), uses 20 env vars, parallel branch checkouts, needs_server semantics. Many host-OS assumptions (port allocation, worktrees, dev server lifecycle).

### archon-issue-review-full
- **File:** `.archon/workflows/defaults/archon-issue-review-full.yaml`
- **Nodes:** 13 (bash:1, command:12)
- **DAG depth / max parallelism:** 9 / 5
- **Providers:** (neutral / inferred from commands)
- **External tools:** gh, git, npm, pnpm, yarn, jq, cargo
- **Env / secrets (12):** `$BASE_BRANCH`, `$ACTUAL`, `$EXPECTED`, `$PR_NUMBER`, `$ARGUMENTS`, `$ARTIFACTS_DIR`, `$WORKFLOW_ID`, `$PR_BASE`, `$PR_HEAD`, `$DOCS_DIR`, `$BEHIND`, `$HEAD_BRANCH`
- **Schedule:** (none)
- **Human-in-the-loop:** (none)
- **Output artifacts:** `.archon/commands/`, `docs/PULL_REQUEST_TEMPLATE.md`, `GitHub PR`, `git commit`, `GitHub comment`
- **Behavior:** Issue-scoped end-to-end superpipeline: investigate the issue (root-cause + plan), implement the fix and open the PR, run 5 parallel review agents with scope awareness, fix CRITICAL/HIGH findings, and produce a final decision matrix. Heavier counterpart to `archon-fix-github-issue`.
- **Port risk:** **High** — Composite of fix-issue + 5-agent review with scope awareness. Carries every dependency both children carry.

### archon-interactive-prd
- **File:** `.archon/workflows/defaults/archon-interactive-prd.yaml`
- **Nodes:** 8 (prompt:5, approval:3)
- **DAG depth / max parallelism:** 8 / 1
- **Providers:** claude
- **External tools:** (none detected)
- **Env / secrets (2):** `$ARGUMENTS`, `$ARTIFACTS_DIR`
- **Schedule:** (none)
- **Human-in-the-loop:** 3 approval node(s)
- **Output artifacts:** `PRD markdown doc`
- **Behavior:** Human-in-the-loop PRD authoring: asks foundation questions, waits for the user, researches market + codebase, asks deep-dive questions, waits again, assesses feasibility with scope questions, waits, then generates the PRD with claims validated against the codebase. Three explicit approval gates.
- **Port risk:** **Med** — No external tools, but 3 approval nodes require Switch UI to wire up interactive approval/wait modal events into the workflow engine.

### archon-piv-loop
- **File:** `.archon/workflows/defaults/archon-piv-loop.yaml`
- **Nodes:** 9 (prompt:3, bash:2, loop:4)
- **DAG depth / max parallelism:** 9 / 1
- **Providers:** claude
- **External tools:** gh, git, npm, pnpm, yarn
- **Env / secrets (10):** `$ARGUMENTS`, `$LOOP_USER_INPUT`, `$ARTIFACTS_DIR`, `$PLAN_FILE`, `$TASK_COUNT`, `$USER_MESSAGE`, `$BASE_BRANCH`, `$ACTUAL`, `$EXPECTED`, `$PR_NUMBER`
- **Schedule:** (none)
- **Human-in-the-loop:** (none)
- **Output artifacts:** `GitHub PR`, `git commit`
- **Behavior:** Plan-Implement-Validate loop with human checkpoints. EXPLORE phase iterates with the human until the problem is understood, PLAN phase iterates with the human until the plan is approved, then IMPLEMENT runs with validation. Three loop nodes carry user_input_prompts for the iterative chat.
- **Port risk:** **High** — Loop nodes with user_input_prompt + per-iteration fresh context + pkg-mgr probing; needs full HITL chat surface plus loop semantics in the engine.

### archon-ralph-dag
- **File:** `.archon/workflows/defaults/archon-ralph-dag.yaml`
- **Nodes:** 6 (prompt:2, bash:2, loop:1, command:1)
- **DAG depth / max parallelism:** 6 / 1
- **Providers:** claude
- **External tools:** gh, git, npm, pnpm, yarn
- **Env / secrets (12):** `$ARGUMENTS`, `$PRD_DIR`, `$FOUND`, `$TOTAL`, `$DONE`, `$USER_MESSAGE`, `$WORKFLOW_ID`, `$ARTIFACTS_DIR`, `$BASE_BRANCH`, `$ACTUAL`, `$EXPECTED`, `$PR_NUMBER`
- **Schedule:** (none)
- **Human-in-the-loop:** (none)
- **Output artifacts:** `.archon/ralph/`, `.archon/ralph`, `docs/pull_request_template.md`, `GitHub PR`, `git commit`
- **Behavior:** Detects whether input is an idea, prd.md without stories, or a full prd directory; generates the missing PRD pieces; validates and installs deps; runs the Ralph loop (fresh context per iteration) implementing one story per pass; finally opens a PR and reports completion.
- **Port risk:** **High** — Loop with fresh-context-per-iteration, branching input detection (idea vs prd.md vs prd dir), story-driven scheduling, plus PR creation.

### archon-create-issue
- **File:** `.archon/workflows/defaults/archon-create-issue.yaml`
- **Nodes:** 12 (prompt:6, bash:6)
- **DAG depth / max parallelism:** 8 / 4
- **Providers:** (neutral / inferred from commands)
- **External tools:** gh, git, curl
- **Env / secrets (10):** `$ARGUMENTS`, `$TEMPLATES_FOUND`, `$KEYWORDS`, `$ARTIFACTS_DIR`, `$PORT`, `$SERVER_PID`, `$DATABASE_URL`, `$SERVER_PORT`, `$STATUS`, `$ISSUE_URL`
- **Schedule:** (none)
- **Human-in-the-loop:** (none)
- **Output artifacts:** `.archon/archon.db`, `docs/ISSUE_TEMPLATE.md`, `GitHub Issue`
- **Behavior:** Bug reporter pipeline: classifies the problem area with a haiku model, gathers context in parallel (issue templates, git state, duplicate scan), investigates relevant code, attempts to reproduce using area-specific tooling (browser, CLI, DB), gates the workflow on reproduction success, and either creates an issue with full evidence or reports back the failed repro.
- **Port risk:** **High** — Uses agent-browser, CLI repro, DB query tooling per problem-area; reproduction gate logic; haiku model dependency; deep gh integration.

### archon-refactor-safely
- **File:** `.archon/workflows/defaults/archon-refactor-safely.yaml`
- **Nodes:** 9 (prompt:6, bash:3)
- **DAG depth / max parallelism:** 9 / 1
- **Providers:** claude
- **External tools:** gh, git
- **Env / secrets (10):** `$ARGUMENTS`, `$ARTIFACTS_DIR`, `$TC_EXIT`, `$LINT_EXIT`, `$FMT_EXIT`, `$TEST_EXIT`, `$BASE_BRANCH`, `$ACTUAL`, `$EXPECTED`, `$PR_NUMBER`
- **Schedule:** (none)
- **Human-in-the-loop:** (none)
- **Output artifacts:** `GitHub PR`, `git commit`
- **Behavior:** Behavior-preserving refactor: scans scope, runs read-only impact analysis, plans an ordered task list, executes edits with PostToolUse type-check hooks after every write, runs the full validation suite, performs a read-only behavior-preservation check, and opens a PR with before/after metrics.
- **Port risk:** **Med** — Per-node PostToolUse hooks (lint-after-write, self-review) require the engine to support node-scoped hook execution.

### archon-resolve-conflicts
- **File:** `.archon/workflows/defaults/archon-resolve-conflicts.yaml`
- **Nodes:** 1 (command:1)
- **DAG depth / max parallelism:** 1 / 1
- **Providers:** (neutral / inferred from commands)
- **External tools:** gh, git, jq
- **Env / secrets (4):** `$ARGUMENTS`, `$PR_BASE`, `$PR_HEAD`, `$ARTIFACTS_DIR`
- **Schedule:** (none)
- **Human-in-the-loop:** (none)
- **Output artifacts:** `GitHub comment`
- **Behavior:** Single command-node workflow: fetches the base branch, analyzes conflicts, auto-resolves clean ones, presents options for complex conflicts, then commits and pushes the resolution. Thin wrapper around `archon-resolve-merge-conflicts` command.
- **Port risk:** **Low** — Single command node wrapping git mechanics; easiest to port assuming `archon-resolve-merge-conflicts` command is also ported.

### archon-architect
- **File:** `.archon/workflows/defaults/archon-architect.yaml`
- **Nodes:** 8 (prompt:5, bash:3)
- **DAG depth / max parallelism:** 8 / 1
- **Providers:** claude
- **External tools:** gh, git, eslint
- **Env / secrets (9):** `$ARGUMENTS`, `$ARTIFACTS_DIR`, `$TC_EXIT`, `$LINT_EXIT`, `$TEST_EXIT`, `$BASE_BRANCH`, `$ACTUAL`, `$EXPECTED`, `$PR_NUMBER`
- **Schedule:** (none)
- **Human-in-the-loop:** (none)
- **Output artifacts:** `GitHub PR`
- **Behavior:** Codebase health sweep: scans complexity metrics, analyzes architecture with principled lens, plans targeted simplifications, executes fixes inside self-review loops via PostToolUse hooks (lint after write, self-review) and PreToolUse hooks (inject architectural principles), runs validation, opens a PR.
- **Port risk:** **High** — Heaviest hook usage (PreToolUse + PostToolUse with self-review loops). Engine must support both hook directions and bash-driven scans with linters.

### archon-adversarial-dev
- **File:** `.archon/workflows/defaults/archon-adversarial-dev.yaml`
- **Nodes:** 4 (prompt:2, bash:1, loop:1)
- **DAG depth / max parallelism:** 4 / 1
- **Providers:** claude
- **External tools:** git, curl
- **Env / secrets (7):** `$ARGUMENTS`, `$ARTIFACTS_DIR`, `$ARTIFACTS`, `$SPEC`, `$FOUND`, `$SPRINT_COUNT`, `$STATE_TMP`
- **Schedule:** (none)
- **Human-in-the-loop:** (none)
- **Output artifacts:** `git commit`
- **Behavior:** GAN-style 3-role build pipeline. Planner creates a sprint spec; a state-machine loop alternates Generator (builds) and Evaluator (attacks). Scores below 7/10 send the sprint back with adversarial feedback. Stops on sprint failure after max retries. Greenfield-app oriented.
- **Port risk:** **High** — Loop with state-machine alternation (Generator/Evaluator), per-criterion scoring with hard thresholds, sprint-failure retries. Non-trivial loop control flow.

### archon-assist
- **File:** `.archon/workflows/defaults/archon-assist.yaml`
- **Nodes:** 1 (command:1)
- **DAG depth / max parallelism:** 1 / 1
- **Providers:** claude
- **External tools:** (none detected)
- **Env / secrets (1):** `$ARGUMENTS`
- **Schedule:** (none)
- **Human-in-the-loop:** (none)
- **Output artifacts:** (none detected)
- **Behavior:** Single-node fallback. When no other workflow matches the request, this exposes the full Claude Code agent with all tools and tells the user that assist mode was used (for tracking).
- **Port risk:** **Low** — Single node, no external tools. Trivial port.

### archon-workflow-builder
- **File:** `.archon/workflows/defaults/archon-workflow-builder.yaml`
- **Nodes:** 6 (prompt:3, bash:2, loop:1)
- **DAG depth / max parallelism:** 3 / 3
- **Providers:** claude + codex
- **External tools:** git
- **Env / secrets (4):** `$ARGUMENTS`, `$ARTIFACTS_DIR`, `$BASE_BRANCH`, `$FILE`
- **Schedule:** (none)
- **Human-in-the-loop:** (none)
- **Output artifacts:** `.archon/commands`, `.archon/commands/`, `.archon/workflows`, `.archon/workflows/`, `.archon/scripts/`
- **Behavior:** Bootstrap for new workflows. Scans the codebase, extracts user intent into JSON, generates a workflow YAML, validates it, and saves. The only workflow that references both `claude` and `codex` providers (uses each for different generation roles).
- **Port risk:** **Med** — Only workflow that uses BOTH claude + codex providers; needs schema validator for emitted YAML.

### archon-remotion-generate
- **File:** `.archon/workflows/defaults/archon-remotion-generate.yaml`
- **Nodes:** 5 (prompt:2, bash:3)
- **DAG depth / max parallelism:** 5 / 1
- **Providers:** (neutral / inferred from commands)
- **External tools:** remotion
- **Env / secrets (6):** `$ARGUMENTS`, `$COMP_ID`, `$DURATION`, `$MID_FRAME`, `$LATE_FRAME`, `$RESULT`
- **Schedule:** (none)
- **Human-in-the-loop:** (none)
- **Output artifacts:** `rendered video (mp4)`
- **Behavior:** Video generation pipeline for a Remotion project. AI writes Remotion React code into src/, renders preview stills, renders the full video to .mp4, and emits a summary. Requires a Remotion scaffold (src/index.ts, src/Root.tsx) in cwd.
- **Port risk:** **High** — Hard dep on a Remotion project layout + `remotion` CLI + ffmpeg-class rendering; outside Switch UI scope.

### archon-test-loop-dag
- **File:** `.archon/workflows/defaults/archon-test-loop-dag.yaml`
- **Nodes:** 3 (prompt:1, bash:1, loop:1)
- **DAG depth / max parallelism:** 3 / 1
- **Providers:** (neutral / inferred from commands)
- **External tools:** (none detected)
- **Env / secrets (1):** `$USER_MESSAGE`
- **Schedule:** (none)
- **Human-in-the-loop:** (none)
- **Output artifacts:** `.archon/test-loop-dag-counter.txt`
- **Behavior:** Reference/demo workflow showing a loop node. Initializes a counter, iterates until it reaches 3, reports completion. Not a real product workflow — exists to exercise the DAG-loop semantics in tests/docs.
- **Port risk:** **Low** — Demo. Could port as engine self-test, but no product value.

---

## A. Provider / Capability Matrix

| Workflow | prompt | bash | script | loop | approval | command | claude | codex | gh | git |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `archon-idea-to-pr` |  | ✓ |  |  |  | ✓ | ✓ |  | ✓ | ✓ |
| `archon-plan-to-pr` |  | ✓ |  |  |  | ✓ | ✓ |  | ✓ | ✓ |
| `archon-fix-github-issue` | ✓ | ✓ |  |  |  | ✓ | ✓ |  | ✓ | ✓ |
| `archon-feature-development` |  | ✓ |  |  |  | ✓ | ✓ |  | ✓ | ✓ |
| `archon-comprehensive-pr-review` |  |  |  |  |  | ✓ |  |  | ✓ | ✓ |
| `archon-smart-pr-review` | ✓ | ✓ |  |  |  | ✓ |  |  | ✓ | ✓ |
| `archon-validate-pr` | ✓ | ✓ |  |  |  | ✓ | ✓ |  | ✓ | ✓ |
| `archon-issue-review-full` |  | ✓ |  |  |  | ✓ |  |  | ✓ | ✓ |
| `archon-interactive-prd` | ✓ |  |  |  | ✓ |  | ✓ |  |  |  |
| `archon-piv-loop` | ✓ | ✓ |  | ✓ |  |  | ✓ |  | ✓ | ✓ |
| `archon-ralph-dag` | ✓ | ✓ |  | ✓ |  | ✓ | ✓ |  | ✓ | ✓ |
| `archon-create-issue` | ✓ | ✓ |  |  |  |  |  |  | ✓ | ✓ |
| `archon-refactor-safely` | ✓ | ✓ |  |  |  |  | ✓ |  | ✓ | ✓ |
| `archon-resolve-conflicts` |  |  |  |  |  | ✓ |  |  | ✓ | ✓ |
| `archon-architect` | ✓ | ✓ |  |  |  |  | ✓ |  | ✓ | ✓ |
| `archon-adversarial-dev` | ✓ | ✓ |  | ✓ |  |  | ✓ |  |  | ✓ |
| `archon-assist` |  |  |  |  |  | ✓ | ✓ |  |  |  |
| `archon-workflow-builder` | ✓ | ✓ |  | ✓ |  |  | ✓ | ✓ |  | ✓ |
| `archon-remotion-generate` | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `archon-test-loop-dag` | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |

---

## B. Common Patterns (Shared Subgraphs)

**Linear pipelines (low fan-out, depth ≈ node count):**
- `archon-feature-development` (3 nodes, depth 3)
- `archon-architect` (8 nodes, depth 8)
- `archon-refactor-safely` (9 nodes, depth 9)
- `archon-interactive-prd` (8 nodes, depth 8)
- `archon-remotion-generate` (5 nodes, depth 5)
- `archon-resolve-conflicts` (1 node)
- `archon-assist` (1 node)

**Branching DAGs with 5-way parallel review fan-out** (depth-1-layer width = 5):
- `archon-idea-to-pr`, `archon-plan-to-pr`, `archon-fix-github-issue`, `archon-comprehensive-pr-review`, `archon-smart-pr-review`, `archon-issue-review-full`
- All six call the same five review agents (`archon-code-review-agent`, `archon-comment-quality-agent`, `archon-test-coverage-agent`, `archon-docs-impact-agent`, `archon-error-handling-agent`) and a synthesizer (`archon-pr-review-scope` + `archon-auto-fix-review`). **This is the most reused subgraph in the whole library** and is the obvious first reusable building block.

**Loop-based** (engine must support `loop` node + iteration state):
- `archon-piv-loop` (4 loops, 3 with user_input_prompt)
- `archon-ralph-dag` (1 loop, fresh-context-per-iter)
- `archon-test-loop-dag` (1 loop, counter demo)
- `archon-workflow-builder` (1 loop)
- `archon-adversarial-dev` (1 loop, state-machine alternation)

**Adversarial / multi-agent**: only `archon-adversarial-dev` (Planner / Generator / Evaluator with scoring threshold).

**Shared command building blocks worth porting once:**
1. **Plan-then-PR tail**: `archon-implement-tasks` → `archon-validate` → `archon-finalize-pr` (used by idea-to-pr, plan-to-pr, feature-development).
2. **Five-agent review + auto-fix**: see above — used by 6 workflows.
3. **PR-base setup**: `archon-verify-pr-base`, `archon-pr-review-scope` (used by all PR-review flows).
4. **Plan-setup + confirm-plan**: used by idea-to-pr, plan-to-pr.
5. **PRD generation chain**: used by interactive-prd, ralph-dag, idea-to-pr (when seeded with idea).

---

## C. Porting Risk Table

| Workflow | Risk | Primary blockers |
|---|:-:|---|
| `archon-idea-to-pr` | **High** | Heavy reliance on `gh` CLI, GitHub PR template, scope-limit semantics, and 16 markdown-command dependencies (archon-create-plan, archon-implement-tasks, archon-finalize-pr, code-review-agent, ...). All commands must be ported too. |
| `archon-plan-to-pr` | **High** | Same command-graph + gh dependency as idea-to-pr; needs $ARTIFACTS_DIR plan-file convention. |
| `archon-fix-github-issue` | **High** | Largest workflow (22 nodes, depth 17), needs gh + git + multi-pkg-mgr (npm/pnpm/yarn) + cargo + jq, branching DAG over issue classification, and a draft-PR step keyed to repo PR template. |
| `archon-feature-development` | **Med** | Only 3 nodes, but `archon-implement-tasks` + `archon-finalize-pr` commands carry the complexity (gh + pkg mgrs + tsc + pytest). |
| `archon-comprehensive-pr-review` | **Med** | No prompt/bash inline; the work is in 9 command markdowns + 5-way fan-out review. Easy DAG, but porting depends on those command bodies. |
| `archon-smart-pr-review` | **Med** | Needs PR-complexity classifier prompt plus conditional routing on a custom decision JSON shape; otherwise similar to comprehensive. |
| `archon-validate-pr` | **High** | Spins up dev servers on free ports, runs E2E twice (main + feature), uses 20 env vars, parallel branch checkouts, needs_server semantics. Many host-OS assumptions (port allocation, worktrees, dev server lifecycle). |
| `archon-issue-review-full` | **High** | Composite of fix-issue + 5-agent review with scope awareness. Carries every dependency both children carry. |
| `archon-interactive-prd` | **Med** | No external tools, but 3 approval nodes require Switch UI to wire up interactive approval/wait modal events into the workflow engine. |
| `archon-piv-loop` | **High** | Loop nodes with user_input_prompt + per-iteration fresh context + pkg-mgr probing; needs full HITL chat surface plus loop semantics in the engine. |
| `archon-ralph-dag` | **High** | Loop with fresh-context-per-iteration, branching input detection (idea vs prd.md vs prd dir), story-driven scheduling, plus PR creation. |
| `archon-create-issue` | **High** | Uses agent-browser, CLI repro, DB query tooling per problem-area; reproduction gate logic; haiku model dependency; deep gh integration. |
| `archon-refactor-safely` | **Med** | Per-node PostToolUse hooks (lint-after-write, self-review) require the engine to support node-scoped hook execution. |
| `archon-resolve-conflicts` | **Low** | Single command node wrapping git mechanics; easiest to port assuming `archon-resolve-merge-conflicts` command is also ported. |
| `archon-architect` | **High** | Heaviest hook usage (PreToolUse + PostToolUse with self-review loops). Engine must support both hook directions and bash-driven scans with linters. |
| `archon-adversarial-dev` | **High** | Loop with state-machine alternation (Generator/Evaluator), per-criterion scoring with hard thresholds, sprint-failure retries. Non-trivial loop control flow. |
| `archon-assist` | **Low** | Single node, no external tools. Trivial port. |
| `archon-workflow-builder` | **Med** | Only workflow that uses BOTH claude + codex providers; needs schema validator for emitted YAML. |
| `archon-remotion-generate` | **High** | Hard dep on a Remotion project layout + `remotion` CLI + ffmpeg-class rendering; outside Switch UI scope. |
| `archon-test-loop-dag` | **Low** | Demo. Could port as engine self-test, but no product value. |

---

## GAPS

### Won't port cleanly (host-OS / external-tool blockers)
- **`archon-remotion-generate`** — hard dep on a Remotion React project in cwd + the `remotion` CLI + ffmpeg-class rendering. Outside Switch UI's chat-engine scope. **Skip in v1.**
- **`archon-validate-pr`** — needs free-port allocation, dual checkouts, dev-server lifecycle (`needs_server`), 20 env vars. Defer until Switch UI has a sandboxed worktree/devserver runner.
- **`archon-create-issue`** — area-specific reproduction tooling (`agent-browser`, DB shells, custom CLIs per problem area). Port the issue-creation tail only; gate the repro phase behind a "no-repro fallback" path.
- **`archon-architect`** — depends on engine support for per-node PreToolUse + PostToolUse hooks (self-review loops, lint-after-write). Engine must land hooks first.
- **`archon-adversarial-dev`** — state-machine loop with score-threshold branching and adversarial-feedback retries. Needs loop-with-conditional-restart semantics that none of the simpler loop workflows exercise.

### Dubious value (consider dropping)
- **`archon-test-loop-dag`** — pure demo; counter-to-3. Replace with an engine unit test, do not ship as user-facing workflow.
- **`archon-assist`** — single node that just exposes the bare agent. In Switch UI this is already the default chat behavior; shipping it as a "workflow" is noise.
- **`archon-workflow-builder`** — generates new workflow YAMLs and requires both claude + codex providers. Switch UI does not currently surface workflow authoring as a primary UX; defer until workflow CRUD is in scope.

### Overlap (consider consolidating)
- **`archon-idea-to-pr` vs `archon-plan-to-pr` vs `archon-feature-development`** — three flows for the same destination (PR) differing only in the entry point (idea / plan / plan-without-review). Could collapse into one workflow with a "skip create-plan" / "skip review" toggle, or compose them as a chain of three reusable building blocks (plan-build + execute-build + review-build).
- **`archon-comprehensive-pr-review` vs `archon-smart-pr-review`** — same 5-agent fan-out, smart adds a classifier-driven router. Ship only smart; "comprehensive" becomes `smart --force-all`.
- **`archon-fix-github-issue` vs `archon-issue-review-full`** — full = fix + 5-agent-review tail. Same collapse pattern: fix-github-issue with a `--full-review` flag.
- **`archon-piv-loop` vs `archon-interactive-prd` vs `archon-ralph-dag`** — three loop-based human-in-the-loop flows; piv has the most general primitives. Consider piv as the foundation and present prd / ralph as configured variants.

### Recommended v1 port subset (8 workflows)
`archon-resolve-conflicts`, `archon-feature-development`, `archon-smart-pr-review`, `archon-fix-github-issue`, `archon-plan-to-pr`, `archon-idea-to-pr`, `archon-interactive-prd`, `archon-piv-loop`.
Defer: validate-pr, create-issue, architect, refactor-safely, adversarial-dev, ralph-dag, remotion-generate, workflow-builder, test-loop-dag, assist, comprehensive-pr-review (redundant), issue-review-full (redundant).
