<claude-mem-context>
# Memory Context

# [hermes-workspace] recent context, 2026-05-04 10:11am GMT+2

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (16,096t read) | 407,721t work | 96% savings

### May 4, 2026
4045 12:08a 🔵 runtime_provider.py reads api_key from custom_provider dict with multi-candidate fallback chain
4046 " 🔵 resolve_runtime_provider calls _resolve_named_custom_runtime first for custom provider
4047 12:09a 🔵 _get_named_custom_provider returns None for provider="custom" — causes auxiliary resolution failure
4048 " 🔵 OPENAI_API_KEY already set in .env to a different key (GLM/z.ai), not the manifest key
4049 12:10a ✅ Hermes provider renamed from 'custom' to 'manifest' with key_env: CUSTOM_API_KEY
4050 " 🔵 Gateway restarted successfully with 154 MCP tools from 9 servers registered
4051 " 🔵 Gateway Screen Module Structure
4052 " 🔵 UI settings still writes providers.custom — conflicts with renamed providers.manifest config
4053 12:11a 🔵 settings-dialog.tsx already handles both 'custom' and 'manifest' keys when reading config
4054 " 🔵 Hermes CLI 401 on openrouter 'auto' model — suspected stale fallback config
4055 12:16a 🔵 Hermes CLI routes model=auto to OpenRouter via auxiliary_llm.py bypass
4056 12:19a 🔵 Root cause confirmed: config.yaml uses root-level `provider` key ignored by resolver
4057 12:40a 🔴 package.json merge conflict breaks pnpm dev
4058 1:20a 🔵 20+ files in hermes-workspace/src have unresolved merge conflicts
4059 1:21a 🔵 Local branch is mid-merge — git status shows UU (unmerged) files
4060 " ✅ Created local_backup branch before aborting in-progress merge
4061 1:22a ✅ Local branch reset to upstream/main after aborting in-progress merge
4062 " 🔴 pnpm dev starts successfully after merge abort and reset to upstream/main
4063 1:25a 🔵 origin/local was already at upstream/main HEAD — conflicts were local-only
S944 Debug and fix HTTPError 500 on /api/models and /api/claude-config in hermes-workspace frontend (May 4 at 1:26 AM)
4064 6:55a 🔵 Honcho dialectic memory queries failing repeatedly with "unexpected error"
4065 " 🔵 Dev server running on port 3000 (hbci), not 3001 as expected
4066 " 🔵 Both /api/models and /api/claude-config return HTTPError 500
4067 " 🔵 model-info repeatedly falls back to gateway-capabilities in zero-fork mode; HERMES_DASHBOARD_TOKEN not set
4068 " 🔵 HERMES_API_TOKEN set in workspace .env matches API_SERVER_KEY in hermes-agent .env
4069 6:56a 🔵 Gateway /v1/models works with auth header but workspace proxy returns 500
4070 " 🔵 BEARER_TOKEN read at module load time — may be empty if env not populated during SSR init
4071 " 🔵 models.ts imports BEARER_TOKEN as static const — confirms SSR freeze as root cause of 500
4072 " 🔵 pnpm install clean after reset to upstream/main; dev server restarted to clear BEARER_TOKEN freeze
4073 6:58a 🔵 Duplicate symbol "assistantCorruptionWarning" in message-item.tsx causes Vite dependency scan failure
4074 " 🔴 Duplicate const "assistantCorruptionWarning" in message-item.tsx — two declarations 128 lines apart
4075 " 🔴 Removed duplicate assistantCorruptionWarning declaration from message-item.tsx
4076 " 🔴 /api/models returns valid model list after fixing duplicate symbol and restarting dev server
S945 Decide whether to PR the message-item.tsx duplicate symbol bugfix upstream (May 4 at 6:59 AM)
S946 Clean up local branch state and verify dev server health after branch management (May 4 at 6:59 AM)
4077 7:00a 🔵 Stash pop on fix branch only restored pnpm-lock.yaml — message-item.tsx fix not in stash
4078 " 🔵 message-item.tsx fix already applied on PR branch — upstream/main only has one declaration
4079 " 🔵 Local branch is 73 commits ahead of origin/local after merge commit
4080 " 🔵 Local branch has a new merge commit f495e83f on top of PR #287 commits
4081 " 🔵 Local branch reset to upstream/main again — PR #287 commits lost from local
4082 7:01a ✅ origin/local force-pushed to upstream/main HEAD, overwriting PR #287 commits on remote
S947 Audit local_backup commits to confirm no unique features lost after reset to upstream/main (May 4 at 7:01 AM)
4083 7:03a 🔵 local_backup has 20+ unique commits not in upstream/main beyond the 6 open PRs
4084 " 🔵 local_backup has diverged from upstream/main in chat-screen with AgentViewPanel → InspectorPanel swap and activity store removal
S948 Audit local_backup for unique features vs upstream/main — circular context ring discovered (May 4 at 7:03 AM)
4085 7:06a 🔵 Upstream/main replaced controlsMenu with workspaceMenu in chat-composer and removed draft clear + token counter UI
4086 " 🔵 No circular context ring / RadialProgress component in upstream/main chat screen
4087 " 🔵 local_backup context-bar has circular SVG ring; upstream/main context-bar does not
S949 Establish hermes-switchui as a distinct product flavor forked from hermes-workspace (May 4 at 7:07 AM)
4088 8:48a ⚖️ hermes-switchui forked as distinct flavor from upstream outsourc-e/hermes-workspace
4089 " ✅ hermes-switchui project direction saved to Claude project memory
4090 " 🔵 Existing MEMORY.md has conflicting branch-base rule: "branch from origin/main" vs new hermes-switchui rule
4091 " ✅ MEMORY.md updated with hermes-switchui project direction entry
S950 Apply runtime_provider.py defensive fix + commit hermes-switchui branding + push branch (May 4 at 8:48 AM)
4092 9:17a ✅ hermes-switchui branch created from local with all custom commits
4093 9:18a ✅ package.json rebranded from hermes-workspace to hermes-switchui
4094 " 🔵 No CLAUDE.md exists in hermes-workspace project root
S951 Establish hermes-switchui branch, commit all custom work, push to origin, apply runtime_provider.py defensive fix (May 4 at 9:18 AM)
S952 hermes-switchui branch establishment, push to origin, and GitHub repo rename discussion (May 4 at 9:20 AM)
S953 hermes-switchui branch committed, pushed to origin; GitHub repo rename instructions provided (May 4 at 9:20 AM)
**Investigated**: - git status: clean working tree (only .omc/ untracked) after two hermes-switchui commits
    - git log: f9c6cd81 (circular ring + composer) and e9e6a788 (rebrand + CLAUDE.md) on top of custom commit stack
    - git push result: hermes-switchui branch published to Interstellar-code/hermes-workspace, tracking set up
    - Discussed GitHub repo rename (hermes-workspace → hermes-switchui) — requires web UI

**Learned**: - Branch is now fully synced: origin/hermes-switchui tracks local hermes-switchui, 0 commits ahead
    - GitHub repo rename cannot be done via git CLI — requires Settings UI at github.com/Interstellar-code/hermes-workspace/settings
    - After GitHub rename: `git remote set-url origin https://github.com/Interstellar-code/hermes-switchui.git` needed locally

**Completed**: - Commit e9e6a788: chore(switchui): rebrand as hermes-switchui (package.json name/description/author + CLAUDE.md with full architecture docs)
    - Commit f9c6cd81: feat(switchui): circular context ring + composer redesign (context-bar.tsx SVG ring, chat-composer.tsx redesign, ContextBar moved from chat-screen into composer)
    - git push -u origin hermes-switchui → branch live and tracked at Interstellar-code/hermes-workspace
    - Provided step-by-step GitHub repo rename instructions

**Next Steps**: - User to rename GitHub repo via web UI, then run `git remote set-url origin https://github.com/Interstellar-code/hermes-switchui.git`
    - Apply runtime_provider.py defensive fix — still pending entire session; user can run the provided python3 snippet directly: insert provider fallback before final `return cfg` in `_get_model_config()` at /Users/rohits/.hermes/hermes-agent/hermes_cli/runtime_provider.py
    - Optionally rename local workspace folder from hermes-workspace to hermes-switchui


Access 408k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>