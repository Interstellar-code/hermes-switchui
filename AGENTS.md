<claude-mem-context>
# Memory Context

# [hermes-switchui/hermes-switchui-a] recent context, 2026-05-11 10:06pm GMT+2

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (20,723t read) | 1,122,570t work | 98% savings

### May 10, 2026
S1033 Tasks kanban full redo — match design team Tasks.html exactly, analyze + SDD first, then Ralph execution (May 10 at 11:41 AM)
S1034 Review and merge incoming PR from worktree branch to main — PR #11 (skills pagination + drawer extraction) (May 10 at 11:42 AM)
S1035 Fix 4 post-merge issues from PR #11 + revamp MCP pages (May 10 at 11:43 AM)
S1036 Fix 4 post-PR #11 issues now vs bundling with MCP revamp (May 10 at 12:24 PM)
S1037 Merge PR #12 (feat: Matrix-themed Skills + MCP page revamps) into main (May 10 at 12:24 PM)
S1038 Merge PR #12 (Matrix-themed MCP page revamp) into main (May 10 at 12:56 PM)
S1039 Fix all 5 post-PR#12 MCP code review follow-ups and commit (May 10 at 1:00 PM)
S1048 Terminal page Matrix UI revamp — transform existing TerminalWorkspace to match Terminal.html mockup design (May 10 at 1:08 PM)
S1049 Terminal page Matrix design revamp — commit, push, PR creation (May 10 at 7:39 PM)
S1050 Generate image mockup for terminal.html (May 10 at 10:22 PM)
### May 11, 2026
4747 8:46p 🔵 types.ts: State Machine and Validation Implementation Verified
4748 " 🔵 agent-wizard.tsx: WIZ-10 Payload Matches Plan Exactly
4749 " 🔵 glyph-picker.tsx: Generates Up to 12 Suggestions, Seed Stable Per name+role
4750 " 🔵 wizard-step-persona.tsx: Preview Uses List Payload, Not Full Prompt Fetch
4751 8:47p 🔵 wizard-step-model.tsx: No Temperature Sliders, Advanced Panel Correct
4752 " 🔵 wizard-step-skills.tsx: No Path Existence Validation
4753 " 🔵 wizard-step-mcp.tsx: Fallback Catalog Has Wrong MCP URL for context-mode
4754 " 🔵 wizard-step-memory.tsx: All 6 Providers Present with Help Text
4755 " 🔵 wizard-step-review.tsx: Missing system_prompt Editability and No Edit Link for Step 2
4756 " 🔵 profiles-screen.tsx: Wizard Integration Correct, Scroll+Highlight Uses 600ms Delay
4757 " 🔵 personas/list.ts: Preview Truncated at 200 Chars, Not 500
4758 " 🔵 /api/mcp Returns { servers: [] } Shape — wizard-step-mcp.tsx Reads Wrong Key
4759 " 🔵 profiles/create.ts: Server-Side persona_id+system_prompt Coherence Check Present
4760 " 🔵 profile-card.tsx: data-profile Attribute Forwarded Correctly to DOM
4761 " 🔵 CSS: Wizard Selectors NOT Under [data-screen=profiles] Scope
4762 8:48p 🔵 Z-Index Stacking: Wizard (100/101) Correctly Above Drawer (80/81)
4763 " 🔵 personas-browser.ts: readPersona Does Full Directory Scan Per Call — No Cache
4764 8:49p 🔵 profiles-browser.ts: PROFILE_NAME_RE Differs From Wizard NAME_RE
4765 9:22p 🔵 P4 Profiles Detail/Edit Drawer Code Review — Branch feat/ui-revamp-next PR #15
4766 9:25p 🔵 Phase P4 Detail/Edit Drawer Code Review — hermes-switchui-a
4767 9:28p 🔵 Phase P4 Detail/Edit Drawer Code Review — hermes-switchui-a
4768 9:29p 🔵 hermes-switchui P4 Profiles Drawer Code Review Initiated
4772 " 🔵 P4 Drawer Shell (DRW-01): Tier Badge Inline, Not TierBadge Component — POL-05 Violation
4773 " 🔵 DRW-04 Capabilities Tab: WIZ-09a Toolsets MISSING — Silently Skipped
4774 " 🔵 DRW-06 Raw Tab: Show-Path Uses alert() Not Toast — UX Regression vs Plan
4775 " 🔵 DRW-05 MCP Tab: env-var Inline Inputs for Required Secrets MISSING
4776 " 🔵 update.ts Tier-Guard Relaxation: Correct — Allows Initial Set, Blocks Post-Creation Mutation
4777 " 🔵 profiles-screen.tsx Delta: Old Drawer Stub Replaced, AgentRow Type Exported, Rename Dialog Intact
4778 " 🔵 hermes-switchui P4 Plan Architecture: Key Design Decisions Confirmed
4769 " 🔵 hermes-switchui-a profiles-revamp.md — Architecture & Phase Plan
4771 " 🔵 P4 Drawer — Full Component Audit Complete, Persona Tab & Screen Integration Confirmed
4770 9:30p 🟣 P4 Drawer Implementation — Full Component Suite Reviewed
4779 9:33p 🔵 Phase P4 Detail/Edit Drawer Code Review — hermes-switchui-a
4780 9:42p 🔵 P4 Detail Drawer Code Review — hermes-switchui-a feat/ui-revamp-next
4781 " 🔵 P4 Detail/Edit Drawer Code Review Initiated — feat/ui-revamp-next
4782 9:43p 🔵 Profiles Revamp Plan Structure — DRW-01..DRW-06 Spec Details Confirmed
4783 " 🟣 P4 Drawer Shell (DRW-01) — agent-detail-drawer.tsx Implemented
4784 " 🟣 P4 Overview Tab (DRW-02) — drawer-tab-overview.tsx Implemented
4785 " 🟣 PATCH /api/profiles/update Route — Guards and Deep-Merge Logic
4786 " 🟣 profiles-screen.tsx Fully Replaced — Drawer Wired, Old Detail Query Removed
4787 9:44p 🔵 P4 Detail/Edit Drawer Code Review — hermes-switchui-a feat/ui-revamp-next
4788 9:45p 🔵 Reviewer Session on feat/ui-revamp-next, Not feat/terminal-matrix-revamp
4789 " 🔵 P4 Drawer Shell (agent-detail-drawer.tsx) — Structure & Key Findings
4790 " 🔵 DrawerTabOverview — Glyph Edit Missing, POL-02 Banner Present, State Stale After Save
4791 " 🔵 DrawerTabPersona — DRW-03 Mostly Compliant; Uses window.confirm/alert Instead of Modal
4792 9:46p 🔵 hermes-switchui P4 drawer code review initiated on feat/ui-revamp-next
4793 9:47p 🟣 P4 Agent Detail/Edit Drawer — Full Implementation on feat/ui-revamp-next
4794 " 🔵 P4 Detail/Edit Drawer Code Review Requested for hermes-switchui
4795 9:51p 🔵 Three Concrete Bugs Found in P4 Drawer Implementation
4796 " 🔵 last_run Timestamp Unit Inconsistency in Drawer Overview Tab

Access 1123k tokens of past work via get_observations([IDs]) or mem-search skill.
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
