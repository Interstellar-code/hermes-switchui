# Hermes Agent fork compatibility skill plan

## Status and goal

**Status: proposed; not implemented or verified.** Antigravity and Hermes provided read-only reviews; Claude Code's review was pending when this plan was written. Incorporate its feedback when available. No current Switch UI and agent pair has been established as compatible by this investigation.

Create a Switch UI-owned maintainer skill and supporting evidence that detect changes in `Interstellar-code/hermes-agent` and assess whether an exact Switch UI revision continues to work with an exact agent revision. This includes the fork's plugins and custom integration, not just API availability. Upstream is `NousResearch/hermes-agent`; upstream releases are not interchangeable with fork releases.

A verdict must be scoped to the pair, environment, features and tests actually exercised. Neither a registry, release note, route probe, mock test nor version number alone proves end-to-end compatibility.

## Existing evidence and constraints

- The agent fork's `.claude/skills/upstream-sync/SKILL.md` treats its fork registry as an evidence ledger, not a completeness guarantee; `release/SKILL.md` requires an explicitly identified, tested release target. Borrow those principles, not the agent's merge or publishing workflow.
- `src/server/gateway-capabilities.ts` distinguishes gateway and dashboard capabilities, optional functionality and fallback modes. `src/server/hermes-rpc.ts` uses dashboard WebSocket RPC; it is a separate transport from the gateway.
- `src/server/hermes-plugin-sync.ts` implements Switch UI plugin registration and heartbeat. Registration alone does not establish that plugin operations work. Other integration clients include `src/server/workflow-engine/clients/plugin-client.ts`, `src/server/projects-client.ts`, `src/server/hermes-kanban-client.ts` and `src/server/self-improve-client.ts`.
- `src/server/agent-cwd.contract.test.ts` compares UI assumptions with agent source but can skip when the source is unavailable. A required compatibility run must report that skip as an unmet gate.
- `src/server/delegations.ts` reads agent SQLite state directly. Source inspection shows that a missing database or sessions table, or a caught query/parse failure, can return an empty list; runtime failure has not been demonstrated. Its profile-scope comments differ from the reader's current behavior. A cross-profile leak has **not** been demonstrated.
- `scripts/dashboard-smoke.mjs` checks HTTP responses and loose JSON shapes against a running UI; it does not establish pair identity, streaming, persistence or plugin operation. Mocks do not prove the candidate agent implements a contract.
- `install.sh` references the fork installer on `main`, while `Dockerfile` uses `nousresearch/hermes-agent:latest`. Those deployment identities do not by themselves establish that users run the tested fork commit.
- The working tree may contain concurrent user changes. Do not overwrite, stash, discard or attribute them to this work.
## Design responsibilities and alternatives

The skill directs discovery, scope and interpretation; the contained harness executes repeatable checks and captures evidence. Existing unit and contract tests supply narrower evidence, while later CI can invoke the same harness. A skill with manual probes or mock-only tests cannot establish real cross-process behavior; a CI matrix alone repeats those limitations without a trustworthy harness. Extend existing tests where their evidence is applicable rather than building a second testing framework.


## Scope and verdict policy

Before executing a run, declare the deployment, features and expected outcomes being assessed. Derive facts from existing behavior and an authoritative support policy where one exists. A minimum supported version or deployment is **unknown** until established; do not invent a product support policy from a capability probe.

Classify each applicable check as required or optional for that declared configuration. Do not automatically classify browser or delegation behavior as optional merely to obtain a passing result. An absent optional capability is acceptable only if its expected degradation is itself verified.

Per-check outcomes:

| Outcome | Meaning |
| --- | --- |
| Pass | The specified behavior passed against the identified pair. |
| Fail | The check established a contract or user-visible failure. |
| Unverified | A prerequisite, identity, check or environment was unavailable, skipped or inconclusive. |
| Expected degradation | An explicitly optional capability was absent and its documented fallback was verified. |

Overall outcomes are **compatible for the stated scope**, **incompatible**, or **inconclusive**. Required skips, missing runtime provenance and unmet required gates prevent a compatible verdict. Report fallback-only operation separately; it is not evidence that the enhanced path works.
Freeze the declared scope and required checks before execution. Aggregate deterministically: any established in-scope contract failure yields **incompatible**, even if other checks are unverified; report both. Otherwise any unmet required gate yields **inconclusive**. Only all required obligations passing, plus verified degradation for any permitted absent optional capability, yields **compatible for the stated scope**. An optional feature present but broken is a failure if included in scope; an absent optional feature whose fallback is unverified is unverified. Unknown optional evidence must be disclosed and cannot be described as verified coverage. A narrower scope is a separately identified assessment, never a retrospective adjustment to obtain a pass.

A failed local safety or setup gate is an infrastructure failure: record it, mark blocked product checks unverified and return **inconclusive** unless a separate in-scope product contract failure was actually established.


## Pair identity, release discovery and baseline

1. Record the Switch UI commit, agent commit, repository identity, release/tag name if any, tag object and peeled commit, relevant plugin revisions, runtime configuration and test inputs. Support untagged agent commits. For a container assessment, record the actual image digest as well.
2. Discover published releases from `Interstellar-code/hermes-agent` since the last evidenced assessment; list prereleases separately. Compare exact commits as well as release notes. Store and compare both tag object and peeled commit to detect moved tags; stop and investigate a mismatch rather than silently accepting it.
3. Use isolated committed checkouts, or capture sufficient dirty-tree snapshot/diff provenance to reproduce the tested inputs. A commit SHA alone is not the identity of a dirty tree. Do not alter an existing checkout to make it clean.
4. Distinguish the last **evidenced passing pair** from a previous-release control. If no trusted passing pair exists, record the baseline as unknown. A prior release is useful for differential diagnosis but is not presumed good.
5. Compare candidate and control against the same UI revision and scenarios where feasible. Control pass plus candidate failure is stronger regression evidence. If both fail, report unresolved, pre-existing or environmental possibilities; do not automatically assign blame.
6. Keep assessment history, including failures and incomplete runs. Advance the passing baseline only after all required checks pass on the exact recorded pair; skips and incomplete gates block promotion. Record the assessment scope so a narrow pass cannot replace a broader one without making that difference explicit.

## Integration contract ledger

Maintain one compact Switch UI-owned ledger, seeded from actual consumers and expanded as investigations discover interfaces. It is an evidence map, not a substitute for tests or a completeness claim. For each feature record:

- UI consumer, agent or plugin owner, and exact transport or storage interface.
- Required or optional status for a named configuration and expected degraded behavior.
- Consumer-visible behavior and relevant input/output, authentication, profile and persistence invariants.
- Agent and UI tests, real-service/browser scenarios, evidence, known gaps and last assessed pair.

For each assessment, enumerate candidate changes from the pinned comparison commit, including renames and deletions; inspect affected route, RPC, configuration, database and plugin interfaces; trace each to UI consumers and ledger rows. Record new dependencies and every change that cannot be mapped, with evidence and owner. If impact remains uncertain, run broader applicable checks and report the unresolved coverage gap; do not assert completeness from search or probes. Review UI changes and consumers as well as agent changes.

Illustrative entry, not evidence of a pass: **profile-scoped session resume** | consumer: UI session client and BFF | interface: profile-scoped gateway session reads; unscoped reads may use the dashboard | scope: declared profile-aware session configuration | invariant: a session created in profile A resumes with its persisted messages in A, not B | evidence: pinned pair and real-service test result | gap: none only when the stated check actually ran.

## Safety and runtime provenance preflight

No VM, Lima installation or container is required. Start with read-only source and release inspection and focused existing tests. Local isolation through environment variables and temporary directories protects against accidental use of normal state; it is not a security sandbox against untrusted code. Do not run an untrusted candidate merely because temporary state is configured.

- Never modify the installed agent checkout, real Hermes home, user credentials or unrelated running services. Do not auto-start a gateway or dashboard during discovery. Identify process and checkout provenance before attributing any live result to a candidate.
- For state-changing live checks, first obtain explicit approval for the exact commands and side effects. Use a disposable checkout and temporary `HOME`, `HERMES_HOME`, XDG and UI-state paths, dedicated ports, synthetic data and test credentials. Inspect the relevant startup and plugin write paths first; if any cannot be isolated from real state, skip that check and report it unverified. Environment isolation does not prevent deliberate access to absolute host paths.
- Check configured endpoints and process ownership; never kill, reuse or modify a user's service to make a test pass. Stop only processes started by the assessment. Record limitations, skips, errors and cleanup failures. Browser checks use a disposable browser profile rather than the user's session.

Read-only release analysis and focused existing tests can proceed without a live agent. A missing safe live-test setup makes those runtime checks unverified, not a reason to withhold the maintainer skill or claim compatibility.
## Implementation order
### Bounded discovery and artifact contract

Inspect repository skill loading, agent startup, dependencies and plugin APIs before live checks. Record the intended maintainer skill consumer, exact invocation, candidate scope and assertions. The UI's runtime skill catalog is separate; do not assume a repository skill is automatically loaded there.

Use a per-assessment evidence record with exact UI and agent identities, releases/tags and peeled commits where available, scope, checks and their evidence levels, commands, results, skips, risk, provenance and verdict. Record dirty state and never treat a SHA alone as proof of dirty-tree contents. Capture transport and profile attribution where observed, without secrets. The initial baseline is unknown until an evidenced assessment is recorded.

Phase exits: discovery identifies the pair and scope; the skill and ledger document repeatable release analysis and focused checks; live checks run only if their local safety prerequisites are met. Established failures remain failures, while blocked checks are unverified. Never promote a baseline on required skips. A missing live environment does not block creating the skill, but does block an unconditional compatibility claim.


### 1. Establish an initial pair and declared slice

Inspect existing supported behavior, installation paths, agent and plugin startup, and relevant test commands. Establish immutable candidate identity and a control if one is available. Set required outcomes for the chosen slice before execution. Capture policy ambiguities as unknown rather than blocking discovery indefinitely.

### 2. Build the isolated harness and a real first slice
Run the following live checks only in a disposable local environment after verifying their prerequisites and obtaining approval for state-changing operations. Otherwise record them unverified; do not run against production state or stop existing services.
After the safety preflight passes, start the exact candidate and UI/BFF in disposable state. Where feasible, repeat the same checks against the control agent. Begin with:

- **Identity/auth:** test-owned gateway and dashboard process identities and pinned launch paths are recorded; synthetic valid credentials succeed, invalid credentials are rejected, and an unrelated healthy listener is not accepted.
- **Models/chat:** the BFF selects the declared agent-backed transport and model; a unique synthetic request is observed at the candidate agent and then at the local provider; the UI receives the expected ordered streamed text and terminal event. A direct UI-to-provider request, unexpected Responses-to-chat fallback, missing trace or duplicate request is not a pass. Inspect `src/routes/api/send-stream.ts` and record which transport and fallback were exercised.
- **Sessions:** create a session in a synthetic profile and send uniquely identifiable content. Trace which test-owned gateway and dashboard processes serve and persist the chosen path. To claim durable agent persistence, stop and confirm exit of all relevant state-serving agent processes, restart them against the same disposable state and profile, and make a fresh independent agent read for the same session ID; assert the unique content appears exactly once. Do not use a warm UI/BFF cache as the persistence oracle. A UI-only reload or BFF restart establishes reload/resume behavior only; mark durability unverified if the full restart and fresh read did not run.
- **Switch UI plugin:** assert registration carries the test-owned URL and version, then independently observe heartbeat reception; do not require registration fields on the heartbeat. Forward an allowlisted synthetic setting and verify state with a separate plugin readback: the forwarding result alone does not prove persistence. Inject an upstream 4xx/5xx and assert the settings API's existing HTTP 200 response contains `{ok:false}` and independent readback remains unchanged. Separately exercise a rejected browser fetch and document the existing fire-and-forget mirror behavior; do not require a visible UI error without a separate product decision. Test API and browser outcomes separately. Discovery must verify the pinned plugin's endpoint/schema and a reliable failure mechanism; if success, readback or failure cannot be observed, mark that part unverified rather than substituting registration.

The local OpenAI-compatible provider must implement the selected agent request shape, model listing and deterministic streaming response with terminal marker; record whether tool-call deltas and error cases are supported. If the agent cannot use that provider safely, the chat gate is unverified, not passed with mocks. External-provider compatibility is outside this slice and separately reported.

Reuse existing tests and smoke scripts only where they exercise the desired contract and expose failure, exit codes, timeouts and skips. Emit a machine-readable evidence manifest and a readable report for the exact pair. A passing mock suite or UI shell is not a substitute for this slice.
Reuse candidates: `src/server/hermes-rpc.test.ts` provides fake-socket protocol assertions, not real-agent evidence; `playwright.config.ts` provides browser conventions but its fixed target must point to the test-owned UI; `scripts/parity-suite.sh` has workflow scenarios but skips some failed launches and is not a gate as-is. Ensure `agent-cwd.contract.test.ts` inspects the pinned candidate rather than a fallback checkout. Apply the existing slash-execution floor in `src/server/hermes-slash-policy.ts` only to that feature, not to the entire product.


### 3. Seed ledger and expand high-risk contracts

Add focused checks based on consumer impact and changed code:

- **Profiles and sessions:** trace production selection in `src/routes/api/send-stream.ts` and session BFF consumers, not the `chat-backends.ts` wrapper alone. Treat enhanced gateway session streaming, dashboard session reads, profile-scoped gateway session reads, portable gateway chat completions, opt-in Responses and direct-provider routing as distinct paths. Exercise each path within the declared scope independently and record which fallback occurred. For synthetic profiles with colliding session IDs assert explicit profile A cannot retrieve B's messages, including reload/resume and model switching. If a path cannot support profile isolation, report the limitation rather than treating fallback as proof of enhanced behavior.
- **Delegations and database:** use populated synthetic `sessions` and `messages` tables matching the queried columns, with the same parent ID and distinct children in two profile databases; assert BFF responses contain only the selected profile's children. A valid database with no children is an expected empty result. A missing, inaccessible or incompatible-schema database must be reported as unavailable rather than certified as empty; current source returns `[]` for these cases, so record the mismatch as a known failure for an in-scope required delegation contract, or unverified if the fixture cannot establish the cause. This plan authorizes detection and reporting only, not a production behavior change. Establish and approve any API behavior change separately. Omitted-profile leakage remains unproven.
- **Streaming and RPC:** check reasoning-effort semantics, terminal/error/cancel/disconnect/reconnect, no duplicate persisted messages and no persisted assistant turn without a corresponding submitted request, bounded deadlines, and WebSocket ticket/token expiry or renewal where applicable.
- **Plugins:** assert loaded provenance, enabled/disabled behavior, dependency resolution, response shape and a named operation with expected response or state for each in-scope plugin.
- **Upgrade state:** disposable copies or synthetic old-schema state and profile layouts, not only fresh-database startup.
- **User-visible flows:** at least one representative browser journey through the real UI/BFF that asserts a visible and persisted outcome. Expand according to declared feature scope.

Distinguish static/source, mocked, real-service and browser evidence in the report. A source-contract test that cannot inspect the pinned agent is unverified; required skips must not pass the gate.

### 4. Implement the maintainer skill

After the discovery gate establishes the maintainer skill consumer, exact repository path and loading method, implement that skill and verify a fresh maintainer session can discover and invoke it without modifying the real Hermes home. It should instruct a context-free maintainer to:

1. Read the ledger and applicable instructions; determine scope and known evidence.
2. Discover fork releases/commits, pin identities and check moved tags and deployment provenance.
3. Compare agent changes and UI consumers against the ledger, including new or renamed seams.
4. Run safety and identity preflight, then relevant focused checks and real integration scenarios.
5. Record exact commands, results, skips, risk, exclusions and pair identity; apply the verdict and baseline rules above.
6. Stop and report if safety, identity or a required gate cannot be established. Never update the agent fork, publish, commit or push as a side effect without explicit approval.

Use one small ledger, one pair-evidence manifest format and a readable report; avoid parallel registries or a general-purpose test framework. Keep paths and command details grounded in the harness actually implemented rather than inventing commands now.

### 5. Automate after the harness is reliable

Consider scheduled or release-triggered CI only after local runs are deterministic and safe. CI must preserve failures, timeouts and required skips; it must not rely on existing nonblocking jobs as proof. CI setup, policy and any dependencies require their normal review and approval.

## Acceptance criteria

- A maintainer with no prior context can identify and assess an exact fork commit, including an untagged commit, and discover releases since an evidenced baseline.
- The run proves isolation and process provenance before mutations; it never silently uses real credentials, existing user state or unrelated running services.
- The report identifies the exact tested pair and plugin/runtime provenance, scope, commands, outcomes and all exclusions; dirty inputs are not represented by SHA alone.
- Required checks cannot pass by skipping, by falling back to another backend or by accepting a mock in place of the declared real-service scenario.
- A failing or incomplete assessment does not advance the passing baseline. A control comparison does not invent a known-good baseline or claim causality when both sides fail.
- The ledger covers observed integration seams and has a repeatable reconciliation procedure. Unknown coverage and unverified deployment identities remain visible.
- Existing user files, running services and the agent fork are not modified as an unintended side effect. No release, push or commit occurs without approval.

## Open decisions and non-goals

- The authoritative supported-version/deployment policy and which features are mandatory for each configuration need evidence or an explicit product decision; do not infer them from the existence of a probe.
- Choose exact live-check commands and plugin-specific wire details after inspecting the candidate. If safe local isolation or a dependency is unavailable, report the affected check as unverified.
- This plan does not merge upstream into the agent fork, publish either product, certify all possible providers, or claim that a finite test suite guarantees compatibility. Deployment pinning and CI rollout are separate decisions.
