# 01-commits.md — Commit Analysis Findings

## Findings Summary

| Severity | Commit(s) | Finding | Recommended Action |
| :--- | :--- | :--- | :--- |
| **Med** | `d0b678d3`, `86fd4b9d` | **Low-latency hotfixes for Feature #228.** Fixed version detection (`__APP_VERSION__`) and stale compat verdicts within 15 mins of feature merge. Signals insufficient pre-merge testing on plugin-sync. | Implement regression test in `hermes-plugin-sync.test.ts` specifically for the `__APP_VERSION__` define flow. |
| **Low** | `789a8ec2` $\to$ `8fdd1f26` | **Immediate build failure after bump.** Version 2.3.29 broke Docker builds (missing `website/` dir), fixed 8 mins later. | Verify Docker build pipeline has a pre-release "smoke test" for the `website/` asset bundle. |
| **Low** | `2f43ff30` $\to$ `c84fd719` | **Extreme version bump cadence.** 5 version bumps (2.3.30 to 2.3.34) occurred in 2.5 hours on Jun 9. Suggests "versioning as a way to fix things" rather than atomic releases. | Consolidate small a-la-carte fixes into single releases to avoid version pollution. |
| **Low** | (Audit) | **Release Notes Gap.** `.omc/releases/` is missing notes for v2.3.35 through v2.3.43, though the tags and CHANGELOG exist. | Backfill missing `.omc/releases/v2.3.xx.md` files for missing versions to maintain audit trail. |
| **Low** | (Audit) | **Co-author Consistency.** Multiple variations of Claude's attribution (Opus 4.8 vs 1M context vs Fable 5). | Standardize LLM co-author labels (e.g., pick one identity for Claude Opus 4.8). |

## Verified Clean
- **Secrets:** No API keys or tokens leaked in last 7 days (all matches were test fixtures).
- **History Hygiene:** No `fixup!`, `WIP`, or `temp` commits left in `main`.
- **Version Order:** Tags match CHANGELOG sequence.
