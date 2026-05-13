<claude-mem-context>
# Memory Context

# [hermes-switchui/hermes-switchui-a] recent context, 2026-05-13 12:50pm GMT+2

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (18,036t read) | 725,726t work | 98% savings

### May 13, 2026
5154 10:29a 🔵 Duplicate commit — raw config section pushed twice as different hashes
5155 10:33a 🟣 hermes-switchui-a feat/next-2: three settings features shipped this session
5156 " 🔵 SettingsDialog entry point located in primary-nav-v2.tsx
5157 " 🔵 primary-nav-v2.tsx has duplicate useNavigate import and uses Link/useRouterState not useNavigate
5158 10:34a ✅ useNavigate added to primary-nav-v2.tsx router import
5159 " ✅ SettingsDialog import removed from primary-nav-v2.tsx
5160 10:38a 🔵 SettingsDialog on main is 2162-line full-featured modal, not a stub
5161 10:47a 🟣 New matrix-settings-dialog.css: safe Matrix overlay for SettingsDialog modal
5162 10:48a 🟣 Matrix CSS overlay wired to SettingsDialog via data-mset="dialog" attribute
5163 " 🔄 matrix-settings.css: all hardcoded #00FF41 green replaced with theme-token fallbacks
5164 " 🔵 A2A Plugin MVP Plan Gap Review Requested
5165 10:49a 🔵 A2A Plugin MVP Plan — Full Content Read
5166 " 🔵 Hermes Runtime Bridge Entry Point Confirmed: AIAgent.run_conversation()
5167 " 🔵 Hermes Plugin System Architecture Fully Mapped for A2A Integration
5168 10:50a 🔵 Dashboard Plugin HTTP Mounting Mechanism Fully Confirmed
5169 10:51a 🔵 Plugin API Route Mounting: dashboard/plugin_api.py Convention Confirmed in Detail
5170 " 🔵 APIServerAdapter _create_agent() and _handle_runs() Full Pattern Confirmed for A2A Bridging
5171 10:52a 🔵 Dashboard Plugin Discovery Requires dashboard/manifest.json — Two Independent Enable Systems
5172 " 🔵 Dashboard Plugin manifest.json Fields Fully Documented
5173 " 🔵 matrix-terminal.css discovered as next fallback target
5174 11:26a 🔄 CSS theme token hardcoded rgba values replaced with color-mix and CSS variable fallbacks
5175 11:28a 🔄 Migrate hardcoded colors to CSS variables in matrix-files.css
5176 11:29a 🔄 Refactor accent colors to CSS variables with color-mix in matrix-files.css
5177 " 🔵 CSS variable refactoring verified type-safe and complete
5178 " 🟣 Theme fallback tokens applied to matrix-mcp and matrix-files CSS
S1165 Refactor matrix UI CSS files to support theme fallbacks, enabling non-matrix themes (claude-classic amber, slate) to render correctly via cascading CSS variable tokens. (May 13 at 11:29 AM)
S1167 Open PR for feat/next-2 branch covering Settings page revamp, profiles bootstrap, and theme-token fallbacks. (May 13 at 11:30 AM)
5179 11:34a ✅ Commit f3150f28 pushed: theme-token fallbacks for MCP and Files pages
5180 " 🔵 feat/next-2 branch scope: 45 commits, 161 files, 32K+ line additions
5181 " 🟣 PR #18 opened: Settings page, profiles bootstrap, nav, theme-token fallbacks
S1168 Reset worktree to origin/main and create new branch for conductor/operations cleanout plan work (May 13 at 11:34 AM)
5182 12:24p 🔵 Pre-Deletion Audit of Conductor and Operations Cleanup Plans
5183 " 🔵 Conductor Cleanout Plan Content — Full Inventory
5184 " 🔵 Operations Cleanout Plan Content — Full Inventory
5185 12:25p 🔵 Grep Verification: Conductor Deletion Candidates Confirmed Zero External Callers
5186 " 🔵 Grep Verification: Operations Deletion Candidates — Partial False Positives Found
5187 " 🔵 Route Claims, Send-Stream Consumers, and use-operations LOC Verified
5188 12:26p 🔵 LOC Verification, Tests, CSS Gaps, Nav Entries, and Heavy Lib Check Complete
5189 " 🔵 Conductor Screen Single Consumer + Operations Shared Route Import Counts Verified
5190 " 🔵 Critical: overview-tab Confirmed Orphaned; OrchestratorCard Name Collision Found
5191 " 🔵 Cross-Plan Double-Count Check: Zero Overlap Between Deletion Lists
5192 12:27p 🔵 Cross-Plan Preservation Overlap: gateway-api.ts and history.ts in Both Keep Lists
5193 12:38p ✅ Git Worktree Reset to Remote Main + New Branch for Cleanout Plans
5194 " 🔵 Repo State: 45 Commits Ahead of origin/main on feat/next-2
S1169 Reset worktree to origin/main and create new branch for conductor/operations cleanout plan work — COMPLETED (May 13 at 12:39 PM)
5195 12:39p ✅ New Branch feat/conductor-ops-cleanout Created from origin/main
S1170 Awaiting user choice on which cleanout plan to tackle first (May 13 at 12:39 PM)
S1171 Conductor cleanout waves 1-3 executed — all pre-revamp safe dead code deleted (May 13 at 12:42 PM)
5196 12:43p 🔵 Conductor Cleanout Plan: Full Inventory, Dead Code, and Deletion Waves
5197 " 🔵 Wave 1 Dead Code Verified: Zero External Callers Confirmed
5198 " ✅ Wave 1 Dead Code Deleted: 6 Files, ~1,911 LOC Removed
5199 " ✅ Wave 2 Dead Code Deleted: run-console Cluster Removed
5200 " 🔵 Wave 3 Symbol Check: OverviewTab Name Collision, LiveActivityPanel Comment-Only Reference
5201 12:44p 🔵 agent-hub-layout and conductor.tsx Have No Imports of Wave 3 Targets
5202 " ✅ Wave 3 Deleted: live-activity-panel and overview-tab Removed
S1174 Execute conductor-cleanout.md — delete all dead code waves including backend routes, TSC verify clean (May 13 at 12:44 PM)
5203 " ✅ conductor.tsx Monolith Replaced with 8-Line Placeholder
S1172 Execute conductor-cleanout.md and operations-cleanout.md plans on feat/conductor-ops-cleanout branch (May 13 at 12:45 PM)
S1173 Execute conductor-cleanout.md plan — delete dead code waves 1-4, replace conductor.tsx with placeholder, confirm TSC clean (May 13 at 12:45 PM)
S1175 Execute conductor-cleanout.md fully — all waves including backend routes, verify TSC + routeTree clean (May 13 at 12:49 PM)
**Investigated**: - Backend caller grep confirmed only routeTree.gen.ts and gateway-capabilities.ts (/api/conductor/missions — different endpoint) reference conductor routes
    - routeTree.gen.ts checked after backend deletion: grep for conductor-spawn/stop/preview-file returns 0 — auto-regenerated clean
    - Full TSC run (excluding text-shimmer) returns empty — zero errors

**Learned**: - TanStack Router's routeTree.gen.ts auto-regenerated correctly after deleting the 3 route files — no stale refs remain
    - gateway-capabilities.ts /api/conductor/missions is a completely separate dashboard endpoint, unaffected
    - TSC stays clean even with routeTree.gen.ts referencing deleted files — because it regenerated before TSC ran

**Completed**: - conductor-cleanout.md fully executed:
      - 12 frontend files deleted (components, hooks, lib)
      - conductor.tsx → 8-line placeholder stub
      - 5 backend files deleted: conductor-spawn.ts, conductor-stop.ts, preview-file.ts, conductor-mission-sanitize.ts, conductor-mission-sanitize.test.ts
    - routeTree.gen.ts auto-regenerated, zero stale conductor route refs
    - TSC clean (only pre-existing text-shimmer errors)
    - All changes unstaged on feat/conductor-ops-cleanout, awaiting commit

**Next Steps**: - Commit conductor cleanout with descriptive message
    - Read and execute docs/plans/operations-cleanout.md (212 lines)


Access 726k tokens of past work via get_observations([IDs]) or mem-search skill.
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
