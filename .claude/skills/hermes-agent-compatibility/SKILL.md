---
name: hermes-agent-compatibility
description: Check whether a hermes-agent fork commit (usually an upstream NousResearch merge on a sync branch) still works with Switch UI, before it lands on the fork's main. Use when merging upstream into Interstellar-code/hermes-agent, reviewing a sync/upstream-* branch, or upgrading the agent a Switch UI deployment runs.
---

# Hermes agent compatibility check

Switch UI talks to the forked agent over HTTP routes, a dashboard, a WebSocket RPC and a few source-level contracts. An upstream merge into the fork can silently remove or reshape any of them. This skill runs one script that answers: does the merge candidate still serve what Switch UI calls?

## When

1. Before a `sync/upstream-*` branch is merged into the fork's `main` (the main use).
2. Before a deployment moves to a new fork release.

## Run it

From the Switch UI repo root:

```sh
scripts/agent-compat-check.sh --live
# options: --agent-repo DIR (default $HERMES_AGENT_PATH or ~/.hermes/hermes-agent)
#          --base REF (default origin/main)   --candidate REF (default HEAD)
#          --out DIR (default $TMPDIR/agent-compat/<stamp>-<sha>)
```

It is read-only toward the agent repo: it exports the base and candidate with `git archive`, never checks out, fetches, stashes or commits there. Only committed work is tested; the report says when the agent repo has uncommitted changes.

## What it checks

| # | Check | How | Evidence kind |
| --- | --- | --- | --- |
| 1 | Routes | Extracts every `/api/*`, `/v1/*`, `/health` literal from the agent's Python at base and candidate; a removed route that `src/server` still calls is a FAIL | static diff |
| 2 | Surface files | Lists changed files in the agent's API server, dashboard, auth, session, persistence and UI-facing plugins | static diff, for review |
| 3 | Source contract | `src/server/agent-cwd.contract.test.ts` against the candidate's source; a skip counts as UNVERIFIED. Re-run on the base as a control: pass on base + fail on candidate = regression from this merge | agent source contract |
| 4 | UI consumers | Switch UI's own tests for gateway capabilities, sessions API and RPC | mocked unit (proves UI side only) |
| 5 | Live probe (`--live`) | Starts the candidate gateway from the export on 127.0.0.1:18642 with a throwaway `HERMES_HOME`, scrubbed env and a synthetic key; probes health, auth reject, models, session list, create and messages; kills it after | real service |

## Reading the result

The script prints `report.md` and exits `0` PASS, `1` FAIL, `2` UNVERIFIED, `3` setup error.

1. Any FAIL makes the verdict FAIL. Otherwise any UNVERIFIED makes it UNVERIFIED. PASS covers only the checks listed.
2. A skipped test in any group, an unreadable test result, a missing live run or a gateway that did not start is UNVERIFIED, never PASS. Live probes check the response shape, not only the status code.
3. Mocked tests (check 4) never prove the agent side.
4. For each FAIL, read the raw files in the output folder (`vitest-*.json`, `live-*.body`, `live-gateway.log`, `routes-*.txt`) and decide: fix the merge in the agent fork, or update Switch UI in the same release.
5. Walk the "Integration files changed" list against `INTEGRATION.md` (next to this file). Removals and renames there deserve a look even when every check passes: the script cannot see payload-shape changes on a route that still exists.

## Not covered yet

Streaming chat to a real model, dashboard (port 9119) routes, the WebSocket RPC against a live agent, and the hermes-switch-ui plugin round-trip. The script always reports these as UNVERIFIED rows, so a full PASS is impossible until probes exist for them. Browser flows are also not covered. Add a probe when one of these breaks once.

## Practical notes (from a fresh-agent test run)

1. Read `report.md` in the output folder, not the console: long output gets cut.
2. Refresh the base first: `git -C ~/.hermes/hermes-agent fetch origin`. This only updates remote-tracking refs; it does not touch the working tree or branches.
3. List failed contract assertions with messages:
   `node -e 'const r=require(process.argv[1]);for(const t of r.testResults)for(const a of t.assertionResults)if(a.status==="failed")console.log("-",a.title,"\n ",a.failureMessages[0].split("\n")[0])' <out>/vitest-agent-cwd-contract.json`
4. The source contract pattern-matches agent files, so it also fails when upstream only moves code to a new module. For each failure, find where the code went in the candidate and decide: a move (update the contract test and the UI's copied constants) or a behaviour change (fix the fork or Switch UI, and note the decision).
5. Merge gate: FAIL blocks the merge. UNVERIFIED is expected because the three uncovered rows are permanent; the merge can go ahead when every other row passes and someone has walked the changed-files list against `INTEGRATION.md`.

## Rules

1. Never change the agent repo, push, or merge as a side effect. Fixing the fork is a separate, approved step.
2. Never edit or narrow a test to make the check pass.
3. Report the verdict with the base and candidate SHAs and the report path.
