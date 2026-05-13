# Switch Coding Capability Analysis: Hermes vs Claude Code

**Date:** 2026-05-12
**Author:** Switch (Hermes Agent, NousResearch)
**Status:** Strategic reference — captures current state, gap analysis, and roadmap

---

## 1. Core Difference

**Claude Code CLI** is a purpose-built coding specialist. Tight edit→run→fix loop, strong repo navigation, built-in project memory (`CLAUDE.md`), mature TUI, permission UX, slash commands, review mode. It is excellent at being inside one repo and making surgical changes.

**Hermes Switch** is an operations lead with coding capability. Broader tool surface: terminal, file ops, browser, MCPs, Kanban, cron, email, Hindsight memory, skills, context-mode, subagents, Claude Code CLI, Codex CLI. Can orchestrate multi-agent workflows and overnight pipelines. Remembers product decisions across sessions.

The comparison is not zero-sum. The right architecture uses Claude Code as a worker in the Hermes stack.

---

## 2. Can Hermes Achieve Claude Code Parity?

Yes, for most practical coding work. Not by imitating Claude Code, but by building a **Hermes coding mode** with the right substrate: repo context, write access, shell, tests, git discipline, project rules, and an autonomous edit→run→fix loop.

### Where Claude Code Still Wins

- Long interactive refactors inside one repo
- Fast local file navigation
- TUI coding flow with real-time feedback
- Built-in `/review`, `/compact`, `/context`, `/cost`
- Mature permission UX
- Coding-agent prompt tuned by Anthropic specifically for code editing

### Where Hermes/Switch Wins

- Multi-repo / multi-product operations
- Cross-session memory (Hindsight, skills, user profile)
- Combining browser, MCP, Kanban, Hindsight, Telegram, cron, GitHub
- Dispatching Claude Code / Codex / subagents
- Running overnight autonomous pipelines
- Context management via Context Mode MCP
- Database-first workflows
- Turning repeated fixes into reusable skills
- Creating durable process, not just one-off edits

---

## 3. The Coding Substrate: What Makes Claude Code Effective

Claude Code's coding strength comes from these ingredients, in order of importance:

### 3.1 Model Quality
The engine. Without a strong coding model, no workflow saves it.
- Best: Claude Sonnet/Opus via Hermes provider
- Good: GPT-5.5 / strong coding model via Manifest
- For review diversity: Codex or Claude Code as second reviewer

### 3.2 Deterministic Project Context
Every serious repo needs structured context that loads into every session:
- Architecture overview
- Test commands (`pnpm test`, `pytest`, etc.)
- Build commands (`pnpm build`, `cargo build`, etc.)
- Lint/format commands
- "Do not touch" zones
- Branch rules (e.g., `main` = clean upstream, patches on dedicated branch)
- Product decisions and design philosophy
- Preferred UI/style conventions
- Type system and import conventions

Claude Code gets this via `CLAUDE.md` + `.claude/rules/*.md`. Hermes needs the same — either `AGENTS.md`, `.hermes/project.md`, or skills that encode these facts.

### 3.3 The Edit→Run→Fix Loop
Claude Code's strength is the tight loop:
1. Inspect repo state
2. Understand failing behavior or spec
3. Identify exact files
4. Edit surgically
5. Run focused tests
6. Run broader tests
7. Inspect git diff
8. Self-review
9. Optional second-agent review
10. Commit / PR

Without this loop enforced, an agent is just a file editor with opinions.

### 3.4 Tool Precision
Claude Code's `Edit` tool is surgical. Hermes equivalents:
- `read_file` with line numbers and pagination
- `search_files` (ripgrep-backed, faster than shell grep)
- `patch` (fuzzy find-and-replace with syntax checks)
- `write_file` (full file overwrite with auto-lint)
- `terminal` for builds, tests, git
- `mcp_context_mode` for processing huge outputs without context flooding

### 3.5 Worktree Isolation
Claude Code's `-w` worktree mode keeps the main branch clean. Hermes can do the same manually:
- Create worktree per issue/feature
- Run agent there
- Validate independently
- Merge or cherry-pick
- Open PR

### 3.6 Review Gates
Two-stage review is where Hermes can beat Claude Code:
- **Spec review:** Did it implement exactly what was asked?
- **Quality review:** Is it maintainable, typed, tested, safe?

Claude Code often self-reviews in the same context — weaker due to sunk-cost bias. Hermes dispatches a fresh reviewer with clean eyes.

---

## 4. Recommended Operating Model: Coding Conductor

Don't make Switch a Claude Code clone. Make Switch the **coding conductor** who routes work to the right execution engine.

### Routing Matrix

| Task Size | Route | Verification |
|-----------|-------|-------------|
| Tiny fix (1-2 lines) | Switch edits directly with `patch` | Run tests, check diff |
| Medium bug | Switch edits + tests + self-review | Focused test, build, git diff |
| Large feature | Switch writes plan → coding agent implements → Switch verifies | Two-stage review + build + test |
| UI fidelity | Switch uses browser/Z.AI vision → exact fix list to coding agent | Screenshot comparison + build |
| Upstream PR scan | `upstream-release-integration` skill, cherry-pick bugfixes only | Build + test + git log |
| Overnight batch | Kanban tasks + cron trigger | Final report + build status |
| Code review | Codex `exec review` or Claude Code `--from-pr` | Summary posted to PR |

### Worker Dispatch

```
User → Switch (conductor)
         ├─ Direct patch (tiny)
         ├─ delegate_task subagent (medium)
         ├─ Claude Code CLI (large, interactive)
         ├─ Codex CLI (review, alternative impl)
         ├─ Kanban worker batch (parallel/overnight)
         └─ Cron pipeline (scheduled)
```

### Claude Code as Worker

Already supported via `claude-code` skill:
```bash
# Print mode (preferred for single tasks)
claude -p "task" --max-turns 10 --allowedTools "Read,Edit,Bash"

# Interactive mode (multi-turn, needs tmux)
tmux new-session -d -s claude-work
tmux send-keys -t claude-work 'claude' Enter
# ... monitor with tmux capture-pane
```

Switch launches it, monitors it, inspects diffs, runs tests, decides if acceptable. Full orchestration.

---

## 5. Practical Setup Checklist

### A. Create `switch-coding` Operating Doctrine
A skill or repo doc that encodes:
- Default branch rules (main = clean, patches on dedicated branch)
- Test commands per project
- Build commands per project
- Preferred edit style (CSS-only for UI, minimal JSX changes)
- TypeScript conventions
- No upstream wholesale merges
- How to run dev server locally
- How to verify browser UI changes
- Product-specific rules (SwitchUI: no HermesWorld, skip features/UX, cherry-pick bugfixes only)

This becomes the **coding constitution** — loaded into every coding session.

### B. Add Project-Level Agent Docs
For SwitchUI and any serious project:
- `AGENTS.md` (Hermes native)
- `CLAUDE.md` (Claude Code compatible — same facts, shared across tools)
- Optionally `.hermes/project.md` for Hermes-specific extensions

### C. Define Routing Rules Explicitly
Write routing logic into the coding doctrine skill. Example thresholds:
- < 10 lines changed: direct patch
- 10-50 lines: direct patch + test + review
- 50-200 lines: delegate to subagent or Claude Code
- 200+ lines: plan first, then coding agent, then review
- UI changes: always screenshot-verify with Z.AI vision

### D. Make Claude Code Callable as First-Class Worker
Already done via `claude-code` skill. Ensure:
- Print mode is default
- `--max-turns` always set
- `--allowedTools` scoped per task
- Output captured and inspected
- Diffs verified before reporting success

### E. Mandatory Validation Protocol
Every coding task ends with:
1. `git diff --stat` — what changed
2. Focused test/build command — does it work
3. Typecheck/lint if relevant — is it clean
4. Summary of changed files — what was touched
5. Explicit verdict: PASS / PARTIAL / BLOCKED

No silent "done." No unverified claims.

---

## 6. The Stack: Toolset for Coding

This is what the eventual unified coding toolset looks like:

### Primary Tools (Switch Direct)
- `read_file` / `search_files` / `patch` / `write_file` — file operations
- `terminal` — shell, builds, tests, git
- `browser_*` — UI verification (via Helium CDP)
- `mcp_zai_vision_*` — screenshot analysis, OCR, UI comparison
- `mcp_context_mode_*` — large output processing without context flooding

### Coding Agents (Dispatched Workers)
- **Claude Code CLI** — reference implementation for large coding tasks
  - Print mode for one-shots
  - Interactive tmux for multi-turn refactors
  - `--from-pr` for PR reviews
- **Codex CLI** — alternative implementation + code review specialist
  - `codex exec review` for built-in review
  - `--full-auto` for autonomous implementation
  - `--sandbox read-only` for safe analysis

### Orchestration Layer
- `delegate_task` — subagent dispatch for parallel work
- `todo` — session task tracking
- Kanban — persistent task queue for overnight/batch work
- `cronjob` — scheduled execution
- Skills — reusable process documentation

### Memory & Learning
- Hindsight — cross-session semantic memory
- `memory` tool — compact persistent notes
- `session_search` — recall past conversations
- Skills — procedural memory (how to do things)
- Context Mode — ephemeral knowledge base for large artifacts

### Verification & Review
- Two-stage review (spec + quality) via fresh subagents
- Browser screenshot comparison
- Build + test + lint gate
- Git diff inspection
- `dogfood` skill for exploratory QA

---

## 7. Architecture Diagram (Mental Model)

```
┌─────────────────────────────────────────────┐
│                 USER (Rohit)                 │
│         Talks to Switch via Telegram         │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│            SWITCH (Conductor)                │
│                                              │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐ │
│  │ Direct  │  │  Skills  │  │  Memory    │ │
│  │  Patch  │  │  (proc)  │  │ (Hindsight)│ │
│  └─────────┘  └──────────┘  └────────────┘ │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │         ROUTING ENGINE               │   │
│  │  tiny → patch | medium → subagent   │   │
│  │  large → Claude Code | batch → Kanban│   │
│  └──────────────────────────────────────┘   │
└──────┬──────────┬──────────┬────────────────┘
       │          │          │
       ▼          ▼          ▼
  ┌─────────┐ ┌────────┐ ┌────────┐
  │Claude   │ │ Codex  │ │Kanban  │
  │Code CLI │ │  CLI   │ │Workers │
  │(worker) │ │(worker)│ │(batch) │
  └─────────┘ └────────┘ └────────┘
       │          │          │
       ▼          ▼          ▼
  ┌─────────────────────────────────┐
  │         VERIFICATION            │
  │  build + test + lint + review   │
  │  screenshot compare + git diff  │
  └─────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────┐
  │         COMMIT / PR             │
  └─────────────────────────────────┘
```

---

## 8. Key Insight

> "There is no spoon."

"Claude Code vs Hermes" is the wrong frame. Claude Code is a tool in the stack. The question is: **what work should be routed where, and how do we verify the result?**

Claude Code can write code. Switch can decide *what should be coded, by whom, how to verify it, and how to make the workflow repeatable.*

The goal is not parity with Claude Code. The goal is a coding system that is **better than any single coding agent** because it combines:
- Direct editing for precision
- Specialized coding agents for heavy lifting
- Fresh reviewers for quality
- Cross-session memory for learning
- Orchestrated pipelines for throughput

---

## 9. Next Steps

1. **User provides write tools and guidance** — expanded file/shell access, model routing, project-specific configurations
2. **Formalize `switch-coding` skill** — the operating doctrine from Section 5A
3. **Create project-level agent docs** for SwitchUI (Section 5B)
4. **Test the routing matrix** on real tasks — measure which route produces best results
5. **Iterate** — every coding session should update the doctrine with new pitfalls and conventions
6. **Benchmark** — compare direct Switch edits vs Claude Code vs Codex on identical tasks, measure correctness, speed, token cost

---

*This document is a living reference. Update as the coding toolset evolves.*
