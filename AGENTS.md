<claude-mem-context>
# Memory Context

# [hermes-switchui/hermes-switchui-a] recent context, 2026-05-13 8:21am GMT+2

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (16,340t read) | 942,383t work | 98% savings

### May 12, 2026
5076 6:09p 🟣 Settings added as routed NavItem in primary-nav-v2.tsx with dedicated group label
5077 " 🟣 Committed f7f1f5a0: Settings nav group shipped to feat/next-2
5078 6:11p 🔵 Skills screen and CSS file inventory for hermes-switchui-a
5079 " 🔵 SkillsScreen architecture: 3-column layout with collapsible sk-filter panel
5080 " 🔄 matrix-settings.css sidebar (.side) restyled to match matrix-skills.css filter panel pattern
5081 " 🔄 matrix-settings.css sidebar items: hide icon placeholder span, fix group padding, item margin
5082 " 🔄 matrix-settings.css sidebar CSS finalized; tsc clean confirmed
5083 6:13p 🔵 Profiles screen API architecture and data flow
5084 6:20p 🔵 /api/profiles/list is a TanStack Start server route, not a Python backend endpoint
5085 " 🔵 Profiles page shows 2 rows because only 2 disk profiles exist — not a bug
5086 6:21p 🔵 Python backend /api/profiles returns only 2 profiles (default + neo) — confirmed via live curl
5087 " 🔵 Profiles screen confirmed: 6 total rows (4 builtin + 2 disk), "only 2 showing" caused by active Zustand filter
5088 6:38p 🟣 Bootstrap expanded to seed full profile layout — committed and pushed
5089 6:43p 🔵 Dev server started successfully via background task — hermes-agent already running
5090 6:44p 🔵 Port 3000 conflict — dev server restarted on port 3001
5091 6:45p 🔵 Dev server confirmed on port 3001 with fresh process
5092 6:51p 🔵 Bootstrap verified: hermes-switch full profile layout created on disk at 18:45
5093 " 🔵 profiles-browser.ts: BUILTIN_PROFILE_NAMES set protects reserved names from user mutation
5094 6:54p 🔵 Settings dialog architecture: two parallel implementations
5095 7:27p 🔵 settings-dialog.tsx full architecture mapped: sections, content components, dialog shell
5096 " ✅ Settings dialog provider/model cards refactored to semantic chip classes
5097 7:28p 🔄 Custom endpoint Base URL row migrated to semantic row/btn/ctl classes
5098 " 🔄 SettingsDialog DOM structure simplified — wrapper div removed
S1132 Matrix theme CSS refactor for settings dialog — commit, push, and restart clean dev server (May 12 at 7:34 PM)
S1133 Matrix theme CSS refactor for settings dialog — commit pushed, dev server clean restart confirmed (May 12 at 7:36 PM)
S1134 Matrix theme CSS refactor for hermes-switchui-a settings dialog — all work committed, dev server live (May 12 at 7:40 PM)
S1135 Continue CSS variable refactoring of settings-dialog.tsx & audit TypeScript compilation; async agent rebuilding dialog for Matrix theme consistency (May 12 at 7:41 PM)
5099 7:42p 🔄 Settings dialog migrated from Tailwind color utilities to CSS variables
5100 7:44p 🔄 EnterpriseThemePicker converted to inline styles and CSS variables
5101 7:45p 🔄 Connection status badge converted to inline styles with CSS variables
5102 7:46p 🔵 TypeScript error: BrailleSpinner component does not accept style prop
S1136 Refactor settings-dialog.tsx from Tailwind CSS to CSS custom properties for Matrix theme integration (May 12 at 7:46 PM)
S1137 Tailwind→inline style migration for settings-dialog.tsx in hermes-switchui-a (May 12 at 7:46 PM)
5103 7:48p ✅ Settings dialog UI polish: border-radius and subsection heading style
5104 7:49p ✅ Settings dialog full UI normalization pass
S1138 Settings dialog CSS refactor — replace Tailwind with matrix design system classes; settings sidebar visual alignment with Skills sidebar (May 12 at 7:49 PM)
5105 7:50p 🔴 Fixed mutedStyle undefined TS error in Custom Endpoint section (second session)
5106 " ✅ Reverted Tailwind→matrix CSS migration commit f2c4740d
5114 7:51p 🔵 Tool Permission Blockade in Skill Context
5107 8:01p 🔄 Settings Sidebar Styled to Match Skills Sidebar
5108 " 🔵 Settings vs Skills Sidebar Structure Mapped
5109 " 🔵 Settings Sidebar CSS Already Matches Skills Sidebar Pixel Values
5110 8:02p 🔵 Skills Sidebar Search Has No Icon; Settings Has Positioned SVG
5111 " 🔄 sidebar-tree.tsx JSX Updated to Use sk-filter-* Class Names
5112 " 🔄 matrix-settings.css Sidebar Rules Updated to Match Skills Sidebar
5113 8:04p 🔵 Both Files Updated Successfully; tsc Check Failed Due to Wrong Command Syntax
S1139 Settings page visual refactor — align sidebar to Skills filter pattern, CSS-only dialog changes (May 12 at 8:05 PM)
5115 8:05p 🟣 Settings Sidebar CSS Aligned to Skills Sidebar
S1140 Settings screen visual refactor — sidebar aligned to Skills pattern, layout bugs fixed, CSS-only approach enforced (May 12 at 8:05 PM)
5116 8:12p ⚖️ CSS-Only Rule for Settings Dialog Changes
5117 8:13p 🔵 Settings Sidebar Class Structure After Codex Refactor
5118 " 🔵 matrix-settings.css Sidebar CSS Scoping Pattern
5119 " 🔵 matrix-settings.css Root Layout Structure
5120 " 🔵 Active State Class Mismatch in Sidebar CSS
5121 " 🔴 Sidebar Active/Hover/Dirty CSS Rules Fixed
5122 8:14p 🔴 Settings Grid Root Layout Fixed for Nested Container
5123 " 🔴 Sidebar Width Deduplication — Removed Explicit 280px from .side Rule
5124 8:15p 🔴 Settings 2-Col Layout Fix Committed and Pushed
### May 13, 2026
5125 8:17a ⚖️ Session Resume — Settings CSS Refactor Ongoing
S1141 Session resume — dev server restart for visual verification of settings screen changes (May 13 at 8:17 AM)
**Investigated**: Dev server status, localhost:3001 availability, app root HTML to confirm app is running

**Learned**: Dev server uses Vite v7.3.2, runs on localhost:3001. App nav includes Settings, Skills, Memory, Themes, Log. hermes-agent process reuses existing process on restart.

**Completed**: Dev server restarted clean (pkill vite + rm routeTree.gen.ts + PORT=3001 pnpm dev). Server confirmed up at localhost:3001.

**Next Steps**: Visual verification of /settings page — check 2-col layout restored (572c2934 fix) and sidebar matches Skills filter style. Outstanding: mutedStyle TypeScript bug in settings-dialog.tsx still needs minimal fix.


Access 942k tokens of past work via get_observations([IDs]) or mem-search skill.
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
