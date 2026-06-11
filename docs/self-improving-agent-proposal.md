# Self-Improving Hermes Agent — Assessment & Proposal

*Applying the Karpathy autoresearch loop to Hermes agent skills, plugins, and core persona — monitored and controlled from a dedicated Switch UI page.*

Date: 2026-06-10 · Status: Proposal / discussion draft

---

## 1. Your requirement, restated

Hermes agent already self-improves at the **skill layer** (creates, updates, refines skills). But the **harness layer** — profile instructions, system prompt, SOUL.md, USER.md, memory structure — is static and unmonitored. Nothing measures whether the agent's core configuration is actually performing well, and nothing improves it.

You want a closed loop:

```
Gateway/agent logs ──► Metrics (central, tracked, quantified)
                            │
                            ▼
              Analysis: which skill/plugin/persona element underperforms?
                            │
                            ▼
        Proposed edit to SKILL.md / SOUL.md / system_prompt / profile config
                            │
                            ▼
              Validate ──► keep or revert (the "ratchet")
```

…surfaced in a dedicated Switch UI page that monitors all skills/plugins and core profile health.

## 2. What the Karpathy loop actually is (and what made it work)

Autoresearch (karpathy/autoresearch, Mar 2026) runs an agent overnight against a GPT trainer: propose change → run 5-min experiment → measure `val_bpb` → keep if improved, `git reset` if not. ~700 experiments produced ~20 stacked wins, an 11% efficiency gain. Three properties made it work, and **all three are preconditions for your idea**:

1. **An immutable judge.** `prepare.py` defines the metric and neither human nor agent may touch it. The eval is never optimized against itself.
2. **A single objective scalar metric.** `val_bpb` — cheap, deterministic, comparable across experiments.
3. **A cheap, fixed-budget experiment.** 5 minutes per run, fully automated, instantly revertible via git.

The "skill that improves all skills" Substack adaptation generalizes this to SKILL.md files: human approves an eval rubric of **binary yes/no checks** (Phase 1), agent mutates-tests-ratchets autonomously (Phase 2), human reviews a before/after debrief (Phase 3). The binary-check conversion is the key trick — it removes scoring ambiguity so the loop can run unsupervised. AutoVoiceEvals applied the same loop to agent **system prompts** (25% → 100% task success in 20 iterations), proving the pattern transfers from code to persona files.

## 3. Honest mapping to Hermes: where it fits, where it strains

| Karpathy precondition | Skills/plugins | Core persona (SOUL.md, system_prompt) |
|---|---|---|
| Objective metric exists | ✅ Mostly — task success, tool-error rate, retries, tokens-to-completion per skill invocation | ⚠️ Hard — "agent behaves well" is multi-dimensional and subjective |
| Cheap repeatable experiment | ✅ Re-run skill against fixed test inputs | ⚠️ Persona affects *every* session; a fair test needs a diverse scenario suite |
| Immutable judge | ✅ Buildable — golden test set + binary checks | ⚠️ Same, but judge calibration matters much more |
| Safe revert | ✅ Skill files are isolated | ⚠️ A bad persona edit degrades everything at once |

So: **the loop maps cleanly to skills/plugins, and only cautiously to the core harness.** That asymmetry should shape the build order.

### Critical risks (well documented in 2026 literature)

- **Reward hacking / metric gaming.** PostTrainBench (arXiv 2603.08640) found autonomous self-optimizing agents gamed their metric in 3 of 4 base models. If the same LLM proposes edits *and* judges them, in-loop scores rise while real quality stagnates. Your eval set must be held out from the optimization signal.
- **Overfitting to the eval.** A SKILL.md ratcheted against 10 test cases becomes hyper-specific to those 10 cases. Test cases must come from *real* logged sessions, refreshed over time — which is exactly the data your gateway logs give you.
- **Local optima.** The ratchet never accepts "worse before better." Fine for incremental tuning; it won't redesign a skill.
- **Drift on the persona layer.** Agent-drift research (arXiv 2601.04170) shows semantic/behavioral drift compounds across autonomous edit cycles. Darwin Gödel Machine only stayed safe because every self-modification was empirically validated before commit.
- **Cost.** Every experiment is N agent runs. Karpathy's loop was cheap because training was local; yours burns API tokens. Budget caps and small eval suites are mandatory.

**Consensus mitigation:** human-in-the-loop gating on write-back (eval proposes edit + score delta; you approve) until the golden test set is large and diverse (~100+ real examples). This fits Switch UI perfectly — the approval queue *is* the UI page.

## 4. What you already have (more than you think)

The Switch UI survey shows the synthesis layer is the only missing piece:

- **Read/write access to every editable artifact:** SOUL.md, USER.md, MEMORY.md, per-profile `config.yaml` + `system_prompt` (`/profiles` screen), per-agent memory files, SKILL.md content, plugin manifests. Plugin enable/disable/install CRUD is wired.
- **Metrics sources already flowing:** `analyticsUsage/analyticsModels` (tokens, cost, sessions per day), `DashboardSkillsUsageSection` (per-skill load/edit/action counts, last-used), `DashboardLogsSection` (log tail + error/warn tallies), `/api/logs` (agent + gateway logs with level/component filters), `/api/system-metrics`, provider usage polling.
- **Session data:** full sessions API (list/get/messages/search) — the raw material for building golden test cases from real interactions.
- **Missing:** correlation of log errors ↔ skills/sessions, a metrics history store, an eval runner, a proposal/approval queue, and the UI page tying it together.

### Prior art — don't rebuild what exists

- **Anthropic skill-creator (Mar 2026 update)** already does skill evals: test prompts + pass/fail criteria, benchmark mode (pass rate, time, tokens), blind A/B comparator agents, trigger-description optimization. One user reported 67% → 94% skill success in two cycles. Worth studying its eval format even if Hermes skills need their own runner.
- **DSPy/GEPA** for automated prompt-text rewriting from a metric (reflection LM proposes instruction edits). Practical at ~50 training examples.
- **promptfoo** (MIT, now OpenAI-owned) for the eval scaffolding: YAML-declared assertions, LLM-as-judge, A/B comparisons. Breakeven ~20 test cases.
- **Arize Phoenix** (OSS) if you want a proper trace layer instead of parsing raw logs.

Verdict: nothing off-the-shelf does *your* loop end-to-end against Hermes' file layout — but the eval-runner and prompt-optimizer components are solved problems you can wrap rather than invent.

## 5. Verdict

**Worth pursuing — with discipline about scope.** The idea is sound and the timing is right: the metrics plumbing and file write-paths exist in Switch UI, and the pattern is validated publicly. But the version that succeeds is *not* "agent autonomously rewrites its own soul overnight." It is:

1. **Measurement before optimization.** A loop without trusted metrics is noise. The observability page alone is valuable and zero-risk.
2. **Skills before harness.** Skills have objective metrics, isolated blast radius, and cheap experiments. The persona layer comes last, gated, with a scenario suite.
3. **Human-gated writes initially.** You approve every proposed diff in the UI. Autonomy is earned as the golden set matures.

This also has product value beyond your own use: a "Skill Health / Agent Improvement" page is a genuine hermes-switchui differentiator (squarely in the never-upstream feature category per your fork strategy).

## 6. Proposed phases

### Phase 0 — Observability page (~days, zero risk, immediate value)
New `/improve` route in Switch UI. Per-skill scorecard built from data you already fetch: invocations, error rate (logs correlated to sessions), retries, avg tokens/cost per invocation, last-used, trend. Persona section: sessions/day, error/warn trend, cost trend per profile. Add a small SQLite/JSON metrics history store so trends survive restarts. **No loop yet — just make performance visible.** This alone answers "is my harness degrading?" for the first time.

### Phase 1 — Golden test sets from real sessions (~1–2 weeks)
For each of your 4 custom plugins/skills: curate 10–20 test cases *from logged sessions* (the sessions API gives you inputs + expected outcomes). Define binary pass/fail checks per case (skill-creator's eval format is a good template). Build an eval runner that replays cases through the gateway and records pass rate + tokens + latency into the metrics store. Run manually from the UI page. **Still no auto-editing.**

### Phase 2 — Proposal queue (human-gated loop)
A meta-agent job (Hermes itself, or a scheduled task) reads metrics + failing eval cases, proposes a concrete diff to one SKILL.md (one change at a time, Karpathy-style), runs the eval suite against the candidate, and posts to the UI: **diff + before/after scores + cost**. You click approve → file written + git-committed (ratchet) or reject → logged as a failed experiment in `results` history. This is the autoresearch loop with you as the merge gate.

### Phase 3 — Bounded autonomy on skills
For skills whose golden set is mature (50+ cases, stable judge): allow N unattended mutate-test-ratchet iterations within a token budget, auto-revert on regression, full experiment log in the UI. Hold-out eval cases never shown to the proposing agent.

### Phase 4 — Persona/harness optimization (last, always gated)
Build a cross-cutting scenario suite (20–30 diverse multi-turn tasks spanning all skills). Only then allow proposed edits to `system_prompt`/SOUL.md, always human-approved, always validated against the full suite, one sentence-level change per experiment, instant rollback via git. Never let this layer go fully autonomous.

### Build-vs-wrap notes
- Eval runner: consider wrapping **promptfoo** or porting skill-creator's eval format rather than writing scoring logic from scratch.
- Edit proposer: start with a plain "reflection prompt" to a strong model; adopt **DSPy/GEPA** only if naive proposals plateau.
- Ratchet: plain git in `~/.hermes/` (skills + profiles dirs) — commit per experiment, `results.tsv`-style log, exactly like autoresearch.

## 6b. Profile-first variant (chosen direction)

Decision (2026-06-11): start with **Hermes agent profiles** (SOUL.md, USER.md, MEMORY.md, profile `system_prompt`), then extend to skills/plugins. This inverts the original ordering, so the design must compensate for the persona layer's weaknesses (subjective metric, full blast radius, drift risk).

### Treat the three profile files differently — this is the core design rule

| File | Nature | Optimization approach |
|---|---|---|
| SOUL.md / `system_prompt` | **Instructions** — behavior-shaping | ✅ Ratchet loop applies. The editable artifact. |
| USER.md | **Facts about Rohit** | ❌ Never ratchet against task metrics — the loop would "improve" scores by distorting facts. Only verify accuracy/staleness; edits are corrections, human-approved. |
| MEMORY.md / memory/*.md | **Accumulated data** | ⚠️ Not prompt-tuning — this is *hygiene*: dedupe, consolidate, prune stale entries, fix contradictions. Metric = retrieval relevance + size, not task score. Separate maintenance job, not the ratchet. |

So "profile optimization" decomposes into: a ratchet loop on SOUL.md/system_prompt, a fact-checking pass on USER.md, and a consolidation job on memory. Conflating them is how drift and fact-corruption happen.

### Making the persona metric tractable

A persona has no `val_bpb`. Substitute a **per-profile scenario suite**:

- 10–20 multi-turn tasks per profile, seeded from *real logged sessions* (sessions API), reflecting what that profile is actually used for.
- Each scenario scored by **binary checks** (the Substack trick): "Did it use tool X before answering?", "Did it ask before destructive action?", "Did it stay under N tokens?", "Did it respect constraint Y from SOUL.md?" — plus a small LLM-as-judge rubric for tone/persona fidelity, judged by a *different* model than the one proposing edits.
- Aggregate score = weighted pass rate across scenarios. Hold out 30% of scenarios from the proposing agent (anti-gaming).
- Secondary objective: shorter prompt wins ties (AutoVoiceEvals' bloat guard).

### Safety rails specific to the persona layer (non-negotiable)

1. **One sentence-level change per experiment** — never wholesale rewrites.
2. **Human approval on every write**, indefinitely for this layer. The UI shows diff + per-scenario before/after + cost.
3. **Git ratchet on `~/.hermes/profiles/<id>/`** — commit per experiment, instant rollback, `results.tsv`-style history.
4. **Run the full suite, not just failing scenarios** — a fix that breaks two other scenarios is a regression, not an improvement.
5. **Drift anchor:** a small set of "identity invariant" checks (things the profile must always do/say) that can never be traded away for task score.

### Revised phase order

- **Phase 0 — Per-profile observability** (`/improve` route): sessions/day, error+warn rate, cost, token efficiency *per profile*. Needs verification that gateway logs/sessions are tagged with profile id — if not, that's the first gateway-side fix.
- **Phase 1 — Scenario suites for your top 1–2 profiles**, built from real sessions; eval runner replays them and records scores. Manual runs from the UI.
- **Phase 2 — Gated ratchet loop on SOUL.md/system_prompt**: meta-agent proposes one diff → suite runs → UI approval queue → git commit or revert.
- **Phase 3 — Memory hygiene job** (consolidation/pruning, separate metrics) + USER.md staleness checker.
- **Phase 4 — Extend the same runner to skills/plugins** — by now the eval infrastructure exists; skills are the *easier* target and reuse everything.

The big advantage of this order: the eval runner, metrics store, approval queue, and git ratchet built for profiles are a superset of what skills need, so Phase 4 is mostly configuration. The big risk: persona evals are noisier, so expect slower, smaller wins than the skill loop would have shown — don't lose faith in the mechanism because the first layer is the hardest one.

## 6c. `/improve` page — experiment lifecycle spec

Decisions (2026-06-11): engine lives in the **forked hermes-agent as a plugin** (structured metrics, eval runner, meta-agent scheduler, git ratchet, API at `/api/improve/*`); Switch UI provides the `/improve` page consuming that API via the existing dashboard-proxy pattern, capability-probed like `jobs`/`kanban` so the page hides when the plugin isn't installed.

Each experiment is a card moving through a state machine:

```
proposed → approved → live (observing) → verified | reverted
              ↓ (rejected → logged)
```

### 1. Proposal card (state: proposed)
- Side-by-side **old vs new diff** of the changed file (SOUL.md or profile `system_prompt`) — always exactly **one atomic change**, highlighted.
- Meta-agent rationale (e.g. "scenarios 4 and 9 fail because the prompt never states X").
- Offline eval table: per-scenario pass/fail **before vs after**, aggregate score delta, token cost of the eval run.
- Actions: **Approve / Reject / Edit-then-approve**. Reject is logged so the same idea isn't re-proposed.
- A proposal only reaches the queue if the offline suite score improved (or tied with a shorter prompt).

### 2. Observation window (state: live)
- On approve: git commit to `~/.hermes/profiles/<id>/`, change goes live.
- Card shows progress: "12 / 30 sessions observed" (window = N real sessions or T days, configurable per profile).
- Live metrics vs previous baseline: error/warn rate, task completion, retries, token efficiency, periodic LLM-judge spot-scores on real transcripts.
- This is the **second verification stage** — offline eval said it *should* be better; the window proves it *is* better in production. (Karpathy's loop only had the first stage.)

### 3. Verdict
- **Verified:** live metrics hold or improve → change becomes **baseline vN+1**; loop immediately generates the next proposal.
- **Regressed:** automatic `git revert` + notification ("experiment #14 reverted: error rate +18%") + failure logged for the meta-agent. Auto-revert without human gate is acceptable here because it only restores an already-approved known-good state.

### 4. History tab
- `results.tsv` equivalent: every experiment with diff, offline scores, live scores, verdict, cost.
- Baseline version curve per profile — the score ratcheting up over time.

### Loop invariants
1. **One experiment in flight per profile** — otherwise metric changes can't be attributed to a specific edit.
2. **Pause/resume per profile, anytime** — pause stops *new* proposals; an experiment mid-observation finishes its window.
3. Baseline only moves forward via verified experiments (git ratchet); every state transition is logged.
4. Held-out scenarios (≈30%) are never visible to the proposing agent.

Steady state is the endless loop you described: verify → propose → approve → observe → verify → … until paused.

## 7. Open questions before building

1. Does the Hermes gateway log skill invocations with enough structure (skill name ↔ session ↔ outcome) to correlate errors per skill, or does that need a gateway-side change first?
2. Which model proposes edits vs. judges? (They should differ — e.g. Sonnet proposes, separate judge prompt with held-out cases scores.)
3. Token budget per experiment cycle you're comfortable with?
4. Should the metrics store live in the UI (`~/.hermes/improve.db`) or upstream in the gateway? UI-side keeps it Switch-specific and avoids upstream entanglement.

---

## Sources

- [karpathy/autoresearch](https://github.com/karpathy/autoresearch) · [DataCamp guide](https://www.datacamp.com/tutorial/guide-to-autoresearch) · [AI Maker: skill that improves all skills](https://aimaker.substack.com/p/how-i-built-skill-improves-all-skills-karpathy-autoresearch-loop)
- [Anthropic: improving skill-creator (evals/benchmarks)](https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills)
- [DSPy GEPA](https://dspy.ai/getting-started/gepa-optimization/) · [promptfoo](https://www.promptfoo.dev/docs/intro/) · [Arize: closing the loop](https://arize.com/blog/closing-the-loop-coding-agents-telemetry-and-the-path-to-self-improving-software/)
- Risks: [PostTrainBench (reward hacking)](https://arxiv.org/html/2603.08640v2) · [Agent drift](https://arxiv.org/abs/2601.04170) · [Darwin Gödel Machine](https://arxiv.org/html/2505.22954v2)
- [AutoVoiceEvals — loop applied to agent personas](https://x.com/archiexzzz/status/2033258540312510702)
