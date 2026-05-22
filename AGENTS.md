<claude-mem-context>
# Memory Context

# [hermes-switchui] recent context, 2026-05-20 9:23am GMT+2

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (20,170t read) | 382,305t work | 95% savings

### May 19, 2026
8785 1:16a 🔵 Confirmed hermes-switchui Diagram HTML Template Structure
8786 " 🟣 Batch B: 5 More HTML Diagrams Launched for Terminal and Workflow Docs
8787 1:18a 🟣 install-paths.html Created — First Diagram of Batch A Written to Disk
8788 " 🔵 /api/docs-asset Route Security: HTML Diagrams Served with CSP script-src 'none' and nosniff Headers
8789 " 🔵 Gateway Capability Probe Modes and MCP Capability Gating Confirmed from Docs
8843 7:25a 🔵 Open PR #31 on hermes-switchui: feat(workflows) GithubAwesome RSS monitor
8844 " ✅ PR #31 set to auto-merge on hermes-switchui
8845 7:26a ✅ PR #31 merged immediately into hermes-switchui
8846 " 🟣 hermes-switchui main synced: GithubAwesome RSS monitor + tool-catalog workflows landed
9197 11:08p 🔵 Open PR #32: Workflow Engine Backend Toggle + Python Plugin Integration
9198 " 🔵 PR #32 Fully Green and Mergeable
S1723 Debug reported breakage on the hermes agent side (user shared an image showing an error) (May 19 at 11:08 PM)
9199 11:16p 🔵 Hermes Agent Gateway: Health OK but /api/plugins Returns 404
9200 11:17p 🔵 Hermes Gateway Missing All API Routes — /api/workflows and /openapi.json Also 404
9201 " 🔵 Hermes Agent Config: Manifest Provider, Local Terminal, Multi-DB State Layout
S1729 Patch workflow-engine plugin crash: 'PluginContext' object has no attribute 'include_router' (May 19 at 11:17 PM)
### May 20, 2026
9218 12:03a 🔵 Architecture Gap: Workflow Plugin Expects FastAPI App, Hermes Passes PluginContext
9221 " 🔵 PluginContext API Surface Mapped: No ASGI/Router Exposure
9222 12:04a 🔵 Two Parallel Plugin-Route-Mounting Systems in Hermes: web_server vs PluginContext
9223 " 🔵 Hermes Has Two Separate HTTP Servers: FastAPI Dashboard and aiohttp Gateway
9224 " 🔵 Full workflow-engine register() Logic: Router Mount + Two Asyncio Background Tasks
S1731 Diagnose and fix workflow-engine plugin integration gaps in Hermes/SwitchUI — covering HTTP route mounting, background task scheduling, and the frontend plugin probe (May 20 at 12:05 AM)
9225 12:21a 🔵 Hermes PluginContext Missing include_router and Asyncio Loop — Workflow Plugin Partially Operational
9226 " ⚖️ Dual-Repo Sync Required: Workflow Plugin Lives in Both Hermes Agent and SwitchUI
9228 12:23a 🔵 No hermes-agent Repository Found on Development Volume
9230 " 🔵 WorkflowBackendToggle Component — UI Switch Between Native and Plugin Workflow Backends
9232 12:24a 🔵 ensurePluginInstalled — Idempotent Plugin Probe with Auto-Enable via Dashboard Proxy
9233 " 🔵 Dashboard-Proxy Route Returns HTML SPA Instead of JSON — Plugin API Unreachable
9234 " 🔵 Hermes Agent Located at /Users/rohits/.hermes/hermes-agent — Plugin API Endpoints Confirmed
9235 " 🔵 Plugin List Endpoint Is /api/dashboard/plugins, Not /api/dashboard/agent-plugins — ensurePluginInstalled Probes Wrong URL
9236 " 🔴 ensurePluginInstalled Probe URL Fixed to /api/dashboard/plugins/hub with Content-Type Guard
S1733 Diagnose workflow plugin activation gaps and fix frontend probe — tracing from PluginContext limitations through dashboard-proxy, gateway restarts, and plugin loading architecture (May 20 at 12:25 AM)
9238 12:27a 🔵 Hermes Gateway Not Running — Port 8642 Unreachable, No Plugin Log Output
9239 12:28a 🔵 Live Port Map: SwitchUI on 3000, Hermes Agent on 9119, Gateway (8642) Not Running
9240 " 🔵 Hermes Gateway Was Mid-Restart — Clean Shutdown Traced, Restarting at 00:27:25
9241 " 🔵 Gateway Error Log Shows No Workflow/Plugin Errors — MCP Server Failures and Unknown Provider 'clawbay' Noted
9242 12:29a 🔵 Gateway Recurring SystemExit: 75 Crash — Four Instances Crashed at gateway/run.py:17085
9243 " 🔵 Gateway Now Up — API Server on 8642, Kanban Dispatcher Embedded, Cron Ticker Confirmed
9244 " 🔵 Parallel Codex Audit Running on hermes-switchui-a — Bundle 5 HTTP API Security Audit
S1734 Workflow engine plugin HTTP routes confirmed mounted — traced from PluginContext gaps through dashboard restart to live route verification (May 20 at 12:29 AM)
9245 12:30a 🔵 Dashboard Process Not Yet Restarted — Logs Show No Plugin Loading Trace in dashboard.log or dashboard.error.log
S1736 Workflow engine plugin tested and confirmed working — patches landed across two repos (May 20 at 12:31 AM)
S1737 Commit workflow-engine hub URL probe fix to hermes-switchui and offer to push (May 20 at 12:39 AM)
9249 12:39a 🔵 hermes-switchui repo state: two modified files, one untracked plan doc
9250 " 🔴 Fixed workflow-engine probe using wrong hub URL, causing JSON.parse failure
S1738 Inspect agent logs to verify workflow engine patch is live and diagnose remaining warnings (May 20 at 12:40 AM)
9253 12:41a 🔵 Workflow engine boots successfully but HTTP routes and background tasks not mounted due to host PluginContext limitations
S1739 Push workflow-engine hub URL fix to hermes-switchui remote — completed successfully (May 20 at 12:41 AM)
9254 " ✅ Pushed workflow-engine hub URL fix to hermes-switchui remote main
9264 9:14a 🔵 Hermes Has Two Separate Plugin Systems — Workflow Plugin Violates Both Contracts
9265 " ⚖️ Workflow Plugin Refactor Plan: Split Agent vs Dashboard Registration, Remove include_router, Add ctx.register_tool()
9266 " 🔵 Confirmed File Layout of kanban and workflow-engine Plugins on Disk
9267 " 🔵 Both Plugin manifest.json Files Confirmed — workflow-engine Dashboard Already Correctly Structured
9268 9:15a 🔵 Kanban Dispatcher Now Runs Embedded in Gateway — Systemd Service is Deprecated
9269 " 🔵 PluginContext.register_hook() API Confirmed with VALID_HOOKS Set in plugins.py
9270 " 🔵 Complete VALID_HOOKS Set and Gateway Background Task Pattern Confirmed
9271 " 🔵 workflow-engine plugin_api.py Uses sys.path Hack; CronPoller Has In-Process + HTTP Fallback Import Strategy
9272 9:17a ⚖️ OMC Refactor Plan Written: workflow-plugin-refactor.md — 6-Phase Plan with Standalone Daemon Approach
S1748 OMC refactor planning for workflow-engine Hermes plugin — full architectural review and phased plan creation using kanban plugin as reference (May 20 at 9:17 AM)
9273 9:22a ⚖️ Codex Review Step Added to Gap-Filling Workflow

Access 382k tokens of past work via get_observations([IDs]) or mem-search skill.
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
