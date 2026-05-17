<claude-mem-context>
# Memory Context

# [hermes-switchui] recent context, 2026-05-15 12:36pm GMT+2

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (21,858t read) | 194,742t work | 89% savings

### May 10, 2026
S1036 Fix 4 post-PR #11 issues now vs bundling with MCP revamp (May 10 at 12:24 PM)
S1037 Merge PR #12 (feat: Matrix-themed Skills + MCP page revamps) into main (May 10 at 12:24 PM)
S1038 Merge PR #12 (Matrix-themed MCP page revamp) into main (May 10 at 12:56 PM)
S1039 Fix all 5 post-PR#12 MCP code review follow-ups and commit (May 10 at 1:00 PM)
S1100 User asked about "gateway" — clarifying what aspect of the gateway system they wanted to know about (May 10 at 1:08 PM)
### May 12, 2026
S1230 Boards UI cleanup + commit: remove non-backend fields, fix delete button position, commit all boards feature files to feat/boards-page (May 12 at 4:51 PM)
### May 14, 2026
S1261 Resume Claw3D session — establishing visual baseline before further scene edits (May 14 at 12:18 AM)
S1276 Read-only audit of hermes-switchui Matrix3D/retro-office codebase to identify Hermes backend integration points for agents, statuses, sessions, tasks, events, positions, and interactions (May 14 at 11:13 AM)
S1277 Read-only investigation of hermes-switchui repo: find the best existing UI/action path for clicking a Matrix3D office agent to open Hermes session/agent detail/chat (May 14 at 4:41 PM)
S1278 Matrix3D interaction/label pass: enrich OfficeAgent subtitles using live session/roster fields and wire RetroOffice3D click callbacks from Matrix3D adapter only (no retro-office/** changes) (May 14 at 5:09 PM)
### May 15, 2026
6440 8:44a 🔵 Build Warnings: Mixed Dynamic/Static Imports and Oversized Chunks Are Pre-existing Technical Debt
6441 8:45a 🔵 Full Scope of Uncommitted Changes in hermes-switchui Working Branch
6442 " 🔵 `toSessionSummary` Hardcodes `status: 'idle'` for All Non-Ended Sessions — Root Cause of Real-Time Status Gap
6443 8:46a ✅ 13-File Matrix3D Live-Data Integration Staged for Commit — 1,646 Insertions
6445 " 🟣 Commit f421a665: "Stabilize Matrix3D around live Hermes signals" — 13 Files, 1,646 Insertions
6447 " ✅ Commit Amended to Fix Escaped Newlines in Message — Final SHA 3a675df1
6456 8:52a 🔵 Hermes Switch UI Rebrand Plan: NOT YET Executed
6458 " 🔵 Rebrand Progress: 195 "Hermes Workspace" + 146 "hermes-workspace" Strings Still Unreplaced
6463 8:53a ⚖️ Rebrand Execution Plan Defined: 4-Step Approach
6464 " 🔵 Full File Inventory: 97 Files Containing Old Brand Strings
6465 8:54a 🔵 Key File Audit: electron-builder.config.cjs and manifest.json Fully Unupdated; logs.ts Has Both Old and New Paths
6466 " 🟣 Mass Rebrand Executed: 112 Files Updated from "Hermes Workspace" to "Hermes Switch UI"
6467 " 🔵 Post-Rebrand Verification: Only 1 "Hermes Workspace" and 29 "hermes-workspace" Remain — All Legitimate Provenance
6468 " ✅ Residual Deployment URLs Patched and Naming Contract File Renamed
6469 8:55a 🔵 Rebrand Final State: 2 "Hermes Workspace" + 17 "hermes-workspace" Remaining — All Legitimate Provenance
6470 " ✅ Rebrand Git Diff: 96 Files Changed, 324 Insertions, 391 Deletions
6471 " ✅ Rebrand Step 1 Complete; Step 2 In Progress — Naming Contract Rename Confirmed via Git
6472 8:56a 🔴 Rebrand-Triggered Test Failure: Matrix3D scoreLiveMatch Test Breaks Because Active Session Name Changed
6473 " 🔵 Production Build Clean After Rebrand: 739 Modules Transformed, 8.36s
6474 8:57a 🔴 Root Cause Found: inferLiveMatch "looksLikeWorkspaceChat" Guard Still Checks for "hermes workspace" — Misses New "hermes switch ui" Name
6475 " 🔴 Fixed: Matrix3D "looksLikeWorkspaceChat" Guard Updated to Recognize Both Old and New Brand Names
6478 " 🔴 All Tests Green and Build Clean After Matrix3D Guard Fix: 22/22 Tests Pass
6482 8:58a 🔵 ESLint Reports Pre-existing Errors in Store Files — Not Rebrand-Related
6484 " 🔵 Startup Screen and Image Assets: Brand Already Correct — "workspace" Remaining Occurrences Are Generic Code Terms
6486 " 🔴 Splash Screen "Workspace" Subtitle and Loading Quip Updated to "Switch UI"
6488 " 🔴 Discovered Remaining Brand String in update-system.ts: "Workspace checkout has local changes"
6489 8:59a 🔴 Fixed: update-system.ts "Workspace checkout" Error Message Updated to "Switch UI checkout"
6490 " 🔵 Final Brand Audit: Remaining "Workspace" in UI Breadcrumbs and Stale electron Bundle
6491 " 🔵 update-system.ts Has 3 More "Workspace" Reason Strings Needing Brand Update
6492 " 🔴 Fixed: All 4 Remaining "Workspace" Update Reason Strings Patched in update-system.ts
6493 9:00a 🔴 UI Breadcrumb Nav Labels Updated: "Workspace" → "Switch UI" in 3 Screen Top Bars
6494 " 🟣 Rebrand Steps 2-3 Complete: All Tests Pass, Build Clean, Electron Bundle Refreshed
6495 " 🔵 Rebrand Final Pre-Commit State: All Source Strings Clean — 99 Files Staged, docs/naming-contract.md Untracked
6496 9:01a 🔴 CLAUDE.md Project Identity Line Updated: "Hermes Workspace" → "Hermes Switch UI" in Product Description
6497 " ✅ Design Mockups Rebranded, CLAUDE.md Refined, Rebrand Plan Marked Completed
6498 " 🟣 Hermes Switch UI Rebrand Complete: All Tests Pass, Build Clean, Plan Marked Done
6499 9:02a 🔵 Final Scan Clarification: Count Spike from Plan Doc Inclusion — Active Source Is Clean
6500 " 🟣 Rebrand Plan All 4 Steps Completed: Graphify Updated, Code Graph Rebuilt
6501 " ✅ Commit-Ready State Confirmed: 106 Files Modified, .env Untracked, docs/naming-contract.md Needs git add
6602 12:32p 🔵 Office 3D Background Color Change Investigation Initiated
6603 12:33p 🔵 Office 3D Brown Grid Background — Component Hierarchy Traced
6609 " 🔵 Office 3D Brown Grid — Exact Color Token and CSS Classes Located
6612 " 🔵 Matrix3D Office Background Architecture Fully Mapped — CSS Already Green, Brown Comes From Three.js Meshes
6615 12:34p 🔵 Brown Grid Source Confirmed — `meshLambertMaterial color="#c8a97e"` in environment.tsx Floor Planes
6618 " 🔵 Complete Color Inventory for Office 3D Brown-to-Green Migration — 5 Targets Identified
6619 12:35p ⚖️ User Approved Office 3D Green Migration — Implementation Plan Activated
6620 " ✅ matrix3d-office.css — Canvas Zone Background Upgraded to Matrix Green Theme
6621 12:36p ✅ RetroOffice3D Wrapper Background Changed from Dark Brown to Matrix Dark Green
6622 " ✅ Production Build Passed Clean After Office 3D Green Color Migration
6623 " ✅ Graphify Code Graph Refreshed After Office 3D Color Migration

Access 195k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- For architecture, routing, page ownership, or cross-module questions, use Graphify first before raw file search.
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- For page/file mapping questions (for example, "what files power /conductor?"), use Graphify to identify the route, owners, and related modules, then use file search to enumerate concrete frontend files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
