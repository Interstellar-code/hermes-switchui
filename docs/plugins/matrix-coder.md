---
title: Matrix Coder
description: A specialist-coder layer that turns the Hermes agent into a focused coding expert by composing a role-specific persona into each conversation turn.
---

# Matrix Coder

Matrix Coder is a Hermes Agent plugin that promotes the active Hermes session into a focused **specialist** for coding work. It does this by composing a role persona — plain text — into the agent's context and re-asserting it on every turn via the `pre_llm_call` hook. The result is an agent that adopts a specific coding mindset (explorer, planner, implementer, reviewer, and so on) for the duration of a task, without spawning a separate process.

Matrix Coder ships as part of the Hermes Switch UI package and is thematically aligned with Switch UI's Matrix theme, though it is a gateway-level plugin and operates independently of the UI theme setting.

<iframe
  src="/api/docs-asset?path=diagrams/matrix-coder-intent-detection.html"
  width="100%"
  height="980"
  loading="lazy"
  style="border: 0; border-radius: 8px;"
></iframe>

The diagram above traces the full detection path — see [How intent is detected](#how-intent-is-detected) for the step-by-step rules.

## How the persona model works

There is no subagent API involved. A specialist is **composed text** assembled from several shared base contracts plus the chosen role:

- **Specialist contract** — shared identity, scope discipline, and the evidence-first rule.
- **Severity rubric** — four-tier severity scale (BLOCKER / HIGH / MED / LOW / NIT) used when reporting findings.
- **Evidence protocol** — all findings cite `file:line`; low-confidence items are marked as Open Questions rather than stated as fact.
- **Boundary table** — defines what each role may and may not do; each role has advisory read/write guidance; the single-writer-per-file guardrail is enforced at orchestration time.

This composed persona is injected as ephemeral context on each turn, so the agent stays in role across a multi-message session without persistent state.

## The eight roles

Each role specialises the agent's behaviour for a different phase of coding work:

| Role | What it focuses on |
|---|---|
| `explore` | Mapping and understanding existing code; read-only investigation |
| `plan` | Decomposing a goal into ordered, atomic steps before any changes are made |
| `executor` | Surgical implementation — smallest viable diff, verified output |
| `review` | Structured code review with an optional lens (see below) |
| `debug` | Root-cause investigation of failures; evidence-first, no guessing |
| `test` | Writing and evaluating tests; coverage and edge-case focus |
| `verify` | Confirming a change works as intended; observing rather than asserting |
| `simplify` | Removing unnecessary complexity without changing behaviour |

The `review` role accepts an optional **lens** that narrows its focus: `security`, `code`, `api`, `performance`, `quality`, or `deps`.

## Output contract

Every specialist response returns exactly four sections in this order:

1. **Findings** — what was observed, each with a file reference and severity.
2. **Open Questions** — anything that could not be resolved or that requires a decision.
3. **Positive Observations** — what is already correct or well-done.
4. **Recommendation** — a single clear next step.

This structure is consistent regardless of which role is active.

## Invoking Matrix Coder

### Implicit invocation (default)

You do not need to type `matrix` to activate it. The IntentGate — a lightweight, deterministic classifier — reads each message and decides whether it represents nontrivial coding work. When it does, the appropriate role (and optionally a review lens and domain pack) is inferred and silently injected.

Clear, mechanical, low-risk requests — for example `fix README typo` — instead produce a visible recommendation asking whether Hermes should handle the task directly. Unrelated chat receives no injection at all.

### Explicit invocation

Prefix your message with `matrix` to bypass inference and name the role directly. Explicit invocations always take priority.

```
is this auth safe?                              # implicit: review + security lens
why does the API endpoint crash?               # implicit: debug + backend-api domain
matrix review this for security                # explicit role + lens
matrix explore how auth flows through the gateway
matrix executor @backend-api: add CSV export   # explicit role + domain pack
```

### Status and help

The `/matrix` slash command displays the current status — active persona, version, phase — and lists available roles and lenses. It does not dispatch work; all task dispatch goes through conversational messages.

## How intent is detected

Detection runs entirely inside the agent's `pre_llm_call` hook, on **every** turn. It uses only local string and regex heuristics — there is no extra model call to "classify" your message. The decision order is fixed:

**explicit trigger ▸ implicit inference ▸ no-op.**

1. **Guard.** Cron-run sessions and system-preamble turns are skipped before anything else, so background automation never gets a persona injected.

2. **Explicit trigger wins.** If your stripped message starts with the word `matrix` (case-insensitive), the grammar parser owns the turn and a specialist is **always** activated — an explicit invocation is never silently downgraded to a direct answer. The grammar is `matrix <role> [<lens>] [@<domain>] [:] <goal>`; an unknown first token falls back to the `review` role with the whole remainder as the goal.

3. **Coding-intent check.** For every other message, `has_coding_intent` decides whether the turn looks like real coding work. It returns true when **any** of these hold:
   - the text contains a file path or a code file extension — `src/app.ts`, `.py`, `.sql`, `.tsx`, and so on;
   - it starts with a role word (`review`, `executor`, `debug`, …) **and** contains a technical term;
   - it contains a coding term (`api`, `bug`, `react`, `schema`, `repo`, `migration`, `endpoint`, …) **and** also an action verb (`fix`, `add`, `refactor`, `optimize`, …), a `?`, or an opening `is` / `does` / `why` / `where` / `how`.

   If there is no signal, **nothing is injected** and the message goes to Hermes unchanged. Saying "handle it directly" (or similar) also opts out explicitly.

4. **Role, lens, and domain inference.** When coding intent is present, the role is inferred from keyword signals in a fixed priority order — review → verify → debug → test → simplify → explore → plan → executor — defaulting to `review`. A review **lens** (`security`, `performance`, `deps`, `api`, `quality`, or plain `code`) is added only for the `review` role, and a **domain pack** is added when the message clearly names a stack (frontend, backend-api, data-db, infra-cli, plugin-skill-authoring).

5. **Right-sizing gate.** A final check avoids specialist overhead on trivial work. An `executor` or `simplify` request that is **mechanical** (typo, README, comment, rename, formatting), **short** (≤ 10 words), and **not security-sensitive** produces a **DIRECT** verdict: instead of activating a persona, Matrix Coder surfaces a one-line recommendation offering to let Hermes handle it, or to re-run the request prefixed with `matrix` to force a specialist. Anything else produces a **MATRIX** verdict and the inferred persona is composed into the turn.

The resulting route is named `role`, `review:lens`, `role@domain`, or `review:lens@domain`. Because the persona is plain text composed into the turn and re-asserted each time, the companion `post_llm_call` hook clears it afterward — a specialist never leaks into an unrelated follow-up message.

> Note: this is guidance composed into the model's context, not a hard-enforced block. The precedence and right-sizing rules live in `core/intake.py` (explicit grammar) and `core/intent_gate.py` (implicit inference).

## Single-writer-per-file

Matrix Coder enforces that no file is edited by two agents at the same time. File sets are made disjoint at orchestration time; if a change would require editing a file outside the assigned set, the specialist stops and escalates rather than proceeding. The underlying bookkeeping (`claim_files` / `release_files` / `would_conflict`) lives in `core/hermes_bridge.py`.

## Related

- [Plugins overview](./overview.md)
- [A2A Fleet](./a2a-fleet.md)
- [Workflow Engine](./workflow-engine.md)
- [Lazy Load MCP](./lazy-load-mcp.md)
- [Themes](../settings/themes.md)
