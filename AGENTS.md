<claude-mem-context>
# Memory Context

# [hermes-switchui] recent context, 2026-05-27 8:42pm GMT+2

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (23,266t read) | 1,088,451t work | 98% savings

### May 26, 2026
S2476 Continuing hermes-switchui migration: commit and merge defensive null-safe guards for workflow-editor.tsx OverviewTab parsed shape fields (May 26 at 5:44 PM)
S2477 Fix "TypeError: edges is not iterable" crash in workflow editor — systematic null-safety hardening of all ParsedWorkflow field consumers (May 26 at 5:48 PM)
S2480 Push branch fix/workflows-codex-cutover-findings to GitHub remote for hermes-switchui — blocked by DNS resolution failure (May 26 at 5:58 PM)
S2481 Push branch fix/workflows-codex-cutover-findings to GitHub — blocked by host-level DNS/NSS resolution failure (May 26 at 6:57 PM)
S2484 User asked "what were we trying to complete?" — seeking a recap of current in-progress work on the hermes-switchui project (May 26 at 6:58 PM)
S2485 Codex cutover review findings — apply and ship P0/P1/P2 fixes to hermes-switchui workflows feature (May 26 at 7:19 PM)
S2486 Verify whether all files were pushed to remote after a cutover operation in hermes-switchui (May 26 at 7:20 PM)
S2487 Record completion of workflow engine cutover to memory and update project index (May 26 at 7:40 PM)
S2488 hermes-switchui backend audit via OMC agents → file GitHub issues for all discovered problems to tackle one-by-one (May 26 at 7:50 PM)
13846 11:37p 🔵 PR #14 bulk.ts: Archived-Only Guard Enforced Downstream, Not in Route
13847 " 🟣 PR #14 matrix-rain-canvas.tsx: New Canvas Component with Clean Lifecycle
13848 " 🟣 PR #14 tasks-screen.tsx: Archive Done + Purge Archived Bulk Operations with 2-Step Confirm
13849 " 🔄 PR #14 files-screen.tsx: Sidebar Collapse Refactored from Conditional Branches to CSS-Only
13865 11:41p ⚖️ Sequential PR Strategy from Same Branch
13867 11:42p 🟣 PR #24 Merged: Fix Dev Workflow DB Isolation
13868 " 🔵 Merge Audit: Suspicious File Drops Detected in Merge 84e9b9a2
13869 " ✅ Graphify Code Graph Updated Post-Merge
### May 27, 2026
13878 3:24a 🔵 Gateway Capabilities Endpoint Investigation: 127.0.0.1:9119
13884 3:30a 🔵 Trinity Sub-Agent Delegation Not Reflected in Matrix3D Dashboard
13888 3:31a 🔵 OMX crew-status SQLite sessions query investigation
13893 3:43a 🔵 Matrix3DScreen exploration attempted; project wiki missing
13897 3:52a 🟣 Finder-style two-pane layout implemented for /files screen (issue #50)
13899 3:53a 🔵 Code review of ebd89e24 — confirmed bugs and gaps found in source
13910 3:58a 🔵 workspace-agents.ts Agent Status Field Investigation
13913 3:59a 🔵 workspace-agents.ts: Canonical Agent Status Field Model
13914 " 🔵 Matrix3D Presence Merging: Three-Source Agent Data Pipeline
13915 " 🔵 useAgentView Session Kind Filter — Prevents Chat Sessions from Becoming Phantom Agents
13927 4:05a 🔵 Matrix3DConsole Dual-Stream Log Architecture Confirmed
13936 4:10a 🔵 Code Review Initiated: hermes-switchui Commit 6105249f
13937 4:14a 🔵 Phase 3 Pre-Flight Read-Only Review: feat/unified-sessions-sidebar
13938 " ⚖️ Legacy Tasks Cleanup Plan — Structured Critique Requested
13939 " 🔵 Concrete Code State Grounding Legacy Tasks Cleanup Plan
13940 " 🔵 sessions-local-store.ts: Legacy Migration Implementation Verified
13941 " 🔵 sessions-local-store.test.ts: Migration Test Coverage Verified Complete
13942 " 🔵 apply-filters-and-decorate.ts: Archived Decoration and Date-Range Parsing Both Pass
13943 4:16a ⚖️ Code Review Task: phaseToStatus() and __streamToolCalls Extraction in chat-tab-views-v2.tsx
13946 4:17a 🔵 PRD Status for feat/unified-sessions-sidebar: US-001–US-004 Pass, US-005 (Codex Verdict) Pending
13947 " 🔴 phaseToStatus() Fixed: 'failed'/'failure' Now Correctly Map to 'error' in chat-tab-views-v2.tsx
13948 " 🔵 __streamToolCalls Field Is Untyped on ChatMessage Across the Entire Codebase
13949 " 🔵 canExpand Logic Correctly Gates Accordion Expansion on Settled or Data-Bearing Tool Entries
13969 4:32a 🔵 Matrix3DConsole Investigation in matrix3d-screen.tsx
13971 " 🔵 Matrix3DConsole: Full Implementation Map in hermes-switchui
13976 4:38a 🔵 hermes-switchui Docs Verification Pass (Round 1 Fix Audit)
S2492 hermes-switchui docs verification pass — Task A grep checks for round-1 fixes across 7 doc files (May 27 at 4:38 AM)
13998 4:50a 🔵 hermes-switchui Matrix3D Loading State Investigation Initiated
14000 " 🔵 Matrix3D "BOOTING MATRIX3D" Loading UI — Root Cause Identified
14001 4:53a 🔵 Matrix3D Route Ownership Exploration — Wiki Gap Identified
14003 " 🔵 Matrix3D Route Ownership Fully Mapped in hermes-switchui
14010 4:59a 🔵 Phase 1 Code Review Initiated — feat/unified-sessions-sidebar Branch (hermes-switchui)
14012 5:00a 🔵 Phase 1 Fix Verification: DST-Safe Day Bucketing — CONFIRMED PASS
14013 " 🔵 Phase 1 Fix Verification: Kanban Capability in /api/connection-status — CONFIRMED PASS
14014 " 🔵 Phase 1 Fix Verification: sortItems Imported from Production — CONFIRMED PASS
14015 " 🔵 Phase 1 Fix Verification: Memory ID encodeURIComponent — PARTIAL (Production makeId Does NOT Encode)
14016 " 🔵 Phase 1 Fix Verification: badgeCount Field in SessionFeedItem — CONFIRMED PASS
14017 5:02a 🔴 UI Defensive Fix for Stuck Tool Call Phases in OpenAI Responses API Path
14018 " ⚖️ UI-Side Fix Chosen Over Patching send-stream.ts for Stuck Tool Phases
14019 " ⚖️ hermes-switchui: Orchestrator Identity Unification Plan Reviewed
14020 " 🔵 send-stream.ts:626-635 Intentionally Swallows tool.completed — Confirmed in Code
14021 " 🔵 Vitest Cannot Run on External NVMe Volume Due to EPERM on .vite-temp
14022 " 🔴 Exact Diff Confirmed for commit b085c977 — Three Files Changed

Access 1088k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>

## codebase-memory (MCP)

This project is indexed by the `codebase-memory` MCP server (knowledge graph in SQLite).

Rules:
- For architecture, routing, page ownership, or cross-module questions, use the `codebase-memory` tools (`get_architecture`, `search_graph`, `trace_path`, `query_graph`) first before raw file search.
- For page/file mapping questions (for example, "what files power /conductor?"), use `search_graph`/`trace_path` to identify the route, owners, and related modules, then use file search to enumerate concrete files.
- Re-run `index_repository` after large changes to keep the graph current (`auto_index` is off).
