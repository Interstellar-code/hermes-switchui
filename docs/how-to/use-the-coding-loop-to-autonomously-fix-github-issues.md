---
title: Use the coding loop to autonomously fix GitHub issues
description: Set up an autonomous coding loop for a GitHub repo: scrape bugs daily, dispatch a producer agent to open PRs, verify them, and review what landed.
---

# Use the coding loop to autonomously fix GitHub issues

> Set up a daily, autonomous pipeline that picks one bug from your issue queue, writes a fix in an isolated worktree, opens a PR, verifies it against your test suite, and hands you a human merge-review task. You stay the merge gate. The loop handles everything else.

This guide covers two related things:

1. deciding whether the coding loop is the right tool for your repo
2. setting it up and operating it day-to-day

## Is this loop right for you?

The coding loop is a **narrow tool with sharp edges**. It works beautifully for one specific use case and falls over on others. Read this section before setting it up.

### The loop will work well if…

- you have a **GitHub repo with a steady stream of bug-labeled issues**
- your bugs are **small, scoped, and verifiable** — single-file fixes, obvious test coverage, no architectural decisions
- you have a **working test suite** the verifier can actually run (this is non-negotiable)
- you're willing to **review and merge every PR yourself** — the human gate is real, not optional
- you want a **background worker** you can trust to keep the issue queue moving without you babysitting it

### The loop is the wrong tool if…

- your issues are **features, refactors, or design changes** — the loop will silently skip these by design
- the fix needs **architectural decisions** the agent can't make (e.g., "redesign the auth flow")
- your repo **doesn't have a working test suite** — the verifier will fail most confidence checks and the loop will produce noise
- you need a **single urgent PR today** — just branch in a worktree and push; using the loop for a one-off is overhead
- you want **fully autonomous merging** — auto-merge is intentionally disabled in the current build (you always get the merge call)

### The honest pre-flight checklist

Before you set up the loop, confirm:

| Question | If no, the loop will… |
|---|---|
| Does your repo have ≥3 open bug-labeled issues? | sit idle every day |
| Does `pnpm test` / `pytest` / equivalent run cleanly on `main`? | produce mostly failed verifications |
| Can the verifier actually execute the test suite? | fail every PR |
| Do you have ~30 min/week to read PRs and a weekly digest? | pile up unreviewed PRs |

If any of those are no, **fix that first**. The loop amplifies what's already there.

## What you need before you start

- a working Hermes installation
- a GitHub repo you want to operate on
- `gh` CLI authenticated and able to push to the repo
- a working test suite that runs from the command line
- the `coding-loop` skill installed in both `hermes-switch` and `neo` profiles (it ships with Hermes)
- access to the machine running the Hermes gateway

## How the loop works

Before you set it up, see what you're building. The loop is a closed pipeline with one human gate.

```
┌─────────────────────────────────────────────────────────────┐
│  Cron Jobs (4 jobs, agent-driven, enabled on create → pause)│
│                                                             │
│  1. coding-loop-intake (daily 06:35)                        │
│     Agent: Switch                                           │
│     Action: scrape issues → categorize (bug-only) →         │
│             pick the single best candidate →                │
│             kanban_create producer task                     │
│                                                             │
│  2. coding-loop-verifier-trigger (every 10 min)             │
│     Agent: Switch                                           │
│     Action: scan PRs labeled auto-loop →                    │
│             kanban_create verifier task                     │
│                                                             │
│  3. coding-loop-digest (Sunday 18:00)                       │
│     Agent: Switch                                           │
│     Action: read tracker DB → write weekly digest           │
│                                                             │
│  4. coding-loop-monitor (every 5 min, origin-delivered)     │
│     Agent: Switch                                           │
│     Action: health-check the loop → surface stalls/orphans  │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    Native kanban dispatcher
                    (automatic, ~30s tick)
                              ↓
        ┌─────────────────────┴─────────────────────┐
        ↓                                           ↓
┌──────────────┐                          ┌──────────────┐
│ Producer     │                          │ Verifier     │
│ Agent: Neo   │                          │ Agent: Switch│
│ Profile: neo │                          │ Profile:     │
│              │                          │ hermes-switch│
│ Workflow:    │                          │ Workflow:    │
│ 1. Read issue│                          │ 1. Load skill│
│ 2. Worktree  │                          │ 2. Checkout  │
│ 3. Fix       │                          │ 3. Tests     │
│ 4. PR        │                          │ 4. Verify    │
│ 5. Block     │                          │ 5. Complete  │
└──────────────┘                          └──────────────┘
        ↓                                           ↓
        └─────────────────────┬─────────────────────┘
                              ↓
              merge-review task → YOU merge manually
```

The two key constraints to internalize:

- **Bug-only.** Features and enhancements are silently skipped. If you want a feature built, create a normal kanban task — don't route it through the loop.
- **One task per run.** The intake creates exactly one producer task per day. This is enforced in a non-LLM harness script, not in prose, because LLMs don't honor cardinality limits stated in instructions.

## Step 1: Set up the coding-loop workspace

The coding loop lives at `~/hermes/coding-loop/`. If you don't have it yet, pull it from the `coding-loop` skill's working directory or recreate it from the skill bundle.

Verify the workspace exists:

```bash
ls ~/hermes/coding-loop/
```

You should see:

```text
AGENTS.md             # orchestration contract
SKILL.md              # umbrella skill (v2.2+)
prompts/              # what cron-spawned agents read
scripts/              # data collection + worktree helpers
runbooks/             # producer + verifier procedures
references/           # ~38 docs covering every pitfall and decision
signals/              # where failed verifications write evidence
digests/              # weekly output goes here
metrics/              # SQLite tracker DB lives here
```

The skill itself is already installed in both `hermes-switch` and `neo` profiles under `skills/software-development/coding-loop/`. Both copies are md5-verified to be identical.

## Step 2: Create a kanban board for the repo

The loop uses one kanban board per repo. The board name becomes the `tenant` namespace that scopes all tasks for that repo.

Create the board using the kanban CLI:

```bash
hermes kanban --board coding-loop-<repo-name> init
```

For example, for a repo called `acme-api`:

```bash
hermes kanban --board coding-loop-acme-api init
```

**Important:** without a `tenant` field on every `kanban_create` call, tasks from different repos become indistinguishable on a shared board. The intake script handles this automatically — you don't need to do anything beyond creating the board.

## Step 3: Install the four cron jobs (then pause them)

The loop uses four cron jobs. There is **no bootstrap command** — you create each one with `hermes cron create` and then pause it. This matters: `hermes cron create` enables every new job **immediately** (`state: scheduled, enabled: true`), so you must explicitly pause each one right after creating it, before it fires against a repo you haven't verified.

Each job is agent-driven — it runs a prompt (the canonical prompts live in `~/hermes/coding-loop/prompts/`) as the Switch profile, scoped to your repo via `--workdir`. Create them from a shell:

```bash
REPO=/absolute/path/to/your/repo
PROMPTS=~/hermes/coding-loop/prompts

# 1. Intake — daily 06:35
JOB=$(hermes cron create "35 6 * * *" "$(cat "$PROMPTS/intake.md")" \
  --name coding-loop-acme-api-intake --workdir "$REPO" --deliver origin \
  | grep "Created job:" | awk '{print $3}')
hermes cron pause "$JOB"

# 2. Verifier trigger — every 10 min
JOB=$(hermes cron create "*/10 * * * *" "$(cat "$PROMPTS/verifier-trigger.md")" \
  --name coding-loop-acme-api-verifier-trigger --workdir "$REPO" --deliver origin \
  | grep "Created job:" | awk '{print $3}')
hermes cron pause "$JOB"

# 3. Digest — Sunday 18:00
JOB=$(hermes cron create "0 18 * * 0" "$(cat "$PROMPTS/digest.md")" \
  --name coding-loop-acme-api-digest --workdir "$REPO" --deliver origin \
  | grep "Created job:" | awk '{print $3}')
hermes cron pause "$JOB"

# 4. Monitor — every 5 min, health-checks the loop (inline prompt, no prompt file)
JOB=$(hermes cron create "*/5 * * * *" \
  "Health-check the coding loop for this repo: report any stalled kanban tasks, orphaned auto-loop PRs, or a tripped circuit breaker. Stay silent if everything is healthy." \
  --name coding-loop-acme-api-monitor --workdir "$REPO" --deliver origin \
  | grep "Created job:" | awk '{print $3}')
hermes cron pause "$JOB"
```

| Cron job | Schedule | Purpose |
|---|---|---|
| `coding-loop-<repo>-intake` | daily 06:35 | scrape issues, pick best bug, create producer task |
| `coding-loop-<repo>-verifier-trigger` | every 10 min | find PRs labeled `auto-loop`, create verifier tasks |
| `coding-loop-<repo>-digest` | Sunday 18:00 | read tracker DB, write weekly digest |
| `coding-loop-<repo>-monitor` | every 5 min | health-check the loop, surface stalls/orphans |

Now confirm all four are paused:

```bash
hermes cron list | grep coding-loop-<repo>
```

You should see four jobs, all with `enabled: false`. The next step is a one-off test before you let them run unattended.

> **Note:** job names are yours to pick, but pause/resume operate on the **job ID** printed at creation (captured above as `$JOB`). If you lose it, `hermes cron list` shows the ID next to each name.

## Step 4: Run a one-off end-to-end test

This is the most important step. **Do not skip it.**

Pick one real bug from your repo's issue queue — ideally the smallest, most well-defined bug you have. Create a producer task manually on the board you just created.

The task body needs to look like this:

```markdown
Mode: produce
Issue: #<number>
Repo: <owner>/<repo>
Title: <issue title>
Category: bug
Domain: <ui|api|backend|infra|state|deps|ts-error|security|performance|bug>
Risk: <low|medium|high>
Confidence: 0.85
```

`Mode: produce` is what tells the producer which section of the skill to follow. The dispatcher picks the task up on its next ~30s tick and spawns Neo.

Watch the run:

```bash
hermes kanban --board coding-loop-<repo> show t_<task_id>
```

What should happen, in order:

1. Dispatcher claims the task and spawns Neo
2. Neo provisions a worktree at `../<repo>-slot-a`, hard-synced to `origin/main`
3. Neo reads the issue, writes a fix, runs the targeted tests
4. Neo commits on a branch named `auto/<issue-id>-<slug>`
5. Neo opens a PR labeled `auto-loop`
6. Neo calls `kanban_block(reason="review-required: ...")` — does **not** mark it done

If you see all six, the producer is working. Now create a verifier task the same way, with `Mode: verify` and the PR number.

What should happen next:

1. Verifier trigger (or your manual task) creates the verify task
2. Dispatcher spawns Switch
3. Switch checks out the branch, runs the targeted tests
4. Switch either:
   - **PASS** → labels the PR `verified`, removes `auto-loop`, creates a `merge-review` task for you
   - **FAIL** → writes a signal to `signals/coding/<domain>/<issue-id>.md`

A successful PASS → merge-review task is the signal that your loop is correctly configured. **Don't enable the daily intake until you've seen this end-to-end at least once.**

## Step 5: Enable the daily intake

Once your one-off test passed, enable the four cron jobs. Resume operates on the job ID, so list them first and resume each ID:

```bash
hermes cron list | grep coding-loop-<repo>   # note the ID next to each job
hermes cron resume <intake-id>
hermes cron resume <verifier-trigger-id>
hermes cron resume <digest-id>
hermes cron resume <monitor-id>
```

That's it. The loop is now running.

For the first week, expect the digest to be sparse — the tracker DB needs history to produce meaningful metrics.

## Step 6: Operate the loop day-to-day

Your only required action is **reading and merging PRs**. Everything else is observation.

| When | You do | Loop does |
|---|---|---|
| Daily 06:35 | nothing — let it run | picks the best bug, dispatches Neo |
| Every 10 min | nothing — let it run | finds PRs labeled `auto-loop`, dispatches Switch |
| Switch says PASS | read the `merge-review` kanban task → review the PR → merge it | waits for your merge |
| Switch says FAIL | read the signal in next digest → decide if it's a real bug or a loop miss | records the failure mode |
| Sunday 18:00 | read the weekly digest | clusters signals, surfaces patterns |

**The human merge gate is real.** Every verified PR lands as a `merge-review` task. You read the diff, you decide. Auto-merge will be re-enabled only after your repo has GitHub branch protection with required status checks and the loop has enough tracker history to justify it.

## What the loop will NOT do

Knowing the boundaries is as important as knowing the capabilities.

- **Features, enhancements, and refactors are silently skipped.** The intake categorizes each issue as `bug`, `non-bug`, or `skip`. Only `bug` produces a producer task. If you want a feature built, create a normal kanban task — do not try to route it through the loop.
- **Auto-merge is currently disabled.** Every verified PR gets a `merge-review` task for you to merge manually. This is a deliberate safety choice, not a missing feature.
- **The loop won't work on repos without a working test suite.** The verifier runs targeted tests mapped from the diff. If those tests don't exist or don't pass on `main`, the verifier will fail almost every PR.
- **The loop won't help with urgent one-off PRs.** If you need a fix today, just branch in a worktree and push. The loop's value is the steady drip of small bugs over weeks, not emergency response.
- **The loop won't fix architectural problems.** The intake's confidence check filters out issues that need design decisions. A low-confidence bug becomes a `human-triage` task for you, not a producer task.

## The pending-task guard (per-repo, not global)

The intake checks the board for existing `ready`, `running`, or `blocked` tasks **that target this repo** before creating a new one. This is the per-repo pending-task guard, and it's the most common reason an intake run "did nothing."

A task targets your repo if its `tenant` field matches your repo name. Scratch, admin, and merge-review tasks (no `tenant`, no `auto/` branch) do **not** block intake — they don't touch your worktree.

If your intake is silently skipping, check:

```bash
hermes kanban --board coding-loop-<repo> list --status ready
hermes kanban --board coding-loop-<repo> list --status running
hermes kanban --board coding-loop-<repo> list --status blocked
```

If you see a leftover `ready` task from a previous run, that's your culprit. Archive or block it, then trigger the intake again.

## Troubleshooting

### Intake fires but creates no task

Most often:

- the bug-only filter skipped all candidates (no `bug` issues)
- the single-task-per-run rule picked one but confidence was below 0.6 (it became a `human-triage` task instead)
- the per-repo pending-task guard saw a leftover task on the board

Check the intake's `runs` row in `metrics/coding-loop.db` — it records the skip reason.

### Producer opens a PR but the verifier never picks it up

The verifier trigger only finds PRs with the `auto-loop` label. If your producer didn't add that label, the trigger will never see the PR.

Check:

```bash
gh pr list --label auto-loop --repo <owner>/<repo>
```

If the PR is missing the label, that's a producer runbook regression — check `~/hermes/coding-loop/runbooks/PRODUCER.md` and the producer's session log.

### Verifier keeps saying FAIL on every PR

Three common causes:

- the test suite has pre-existing failures on `main` (the verifier's confidence drops to near-zero)
- the rubric is too strict for your domain (check `runbooks/VERIFIER_RUBRICS.md`)
- the producer is touching files outside scope (look at the diff in the failed signal)

Read the most recent signals in `signals/coding/<domain>/` — the `verifier_check` and `failure_mode` fields tell you exactly what failed.

### The circuit breaker keeps blocking tasks

A blocked task with reason starting `producer-stuck` means the worker heartbeat went stale. The worker subprocess is probably still running but the dispatcher has marked it stuck. Two things to do:

1. check `ps aux | grep -E 'hermes.*(neo|switch)' | grep -v grep` and kill any orphaned workers
2. read the signal in `signals/coding/producer-stuck/<task-id>.md` — the `reproducer` field usually has a one-line "rerun producer on task=X" instruction

### Cron jobs aren't firing

Verify the job is enabled and the schedule is correct:

```bash
hermes cron list | grep coding-loop-<repo>   # is the job enabled? right schedule?
hermes cron status                            # is the cron scheduler itself running?
```

Common mistakes: the job was paused by accident; the schedule is in UTC and you're in a different timezone; the agent's home channel isn't set so the delivery goes nowhere.

## Recommendation

If you're setting this up for the first time:

1. **Start with a one-off test.** Pick the smallest bug in your queue and run Steps 4 manually. Don't enable the daily intake until you've seen a PASS → merge-review at least once.
2. **Let it run for a week before trusting the digest.** The tracker DB needs history to produce meaningful metrics. The first digest will be sparse — that's normal.
3. **Read every PR.** The human merge gate is the safety net. Skim the diff, look at the test results, and merge. The loop's quality is bounded by your review attention.
4. **Don't feed the loop by hand.** If the daily intake hasn't fired yet, don't manually create producer or verifier tasks. Change the cron schedule to the desired time and wait. Hand-created tasks bypass the pending-task guard, the tracker DB, and the single-task-per-run invariant — exactly the collisions this system is designed to prevent.

The loop is a force multiplier, not a replacement for engineering judgment. Use it to keep the small bugs from piling up while you focus on the hard stuff.
