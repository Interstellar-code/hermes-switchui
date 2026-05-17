# Hermes Switch UI — Rebrand Plan

**Status:** Completed  
**Date:** 2026-05-13  
**Scope:** Replace all user-facing "Hermes Workspace" branding with "Hermes Switch UI"

Completed on 2026-05-15. Remaining `outsourc-e/hermes-workspace` and `Hermes Workspace` references are upstream provenance / compatibility aliases, not active product branding.

---

## Rule

- `Hermes Workspace` → `Hermes Switch UI` (or `Switch UI` for short references)
- `hermes-workspace` (in product names, titles, log messages, user-facing strings) → `hermes-switchui`
- Keep `workspace` where it's a technical concept (workspace-store, workspace-shell, workspace root directory, etc.)
- Keep upstream attribution where it credits the original repo
- Update links and URLs only where they point to the old fork identity

---

## 1) App Startup & Screen Strings

These are the highest-impact — users see them immediately.

### `src/routes/__root.tsx`
- **Line 127:** `title: 'Hermes Workspace'` → `title: 'Hermes Switch UI'`
- **Line 478:** `alt="Hermes Workspace"` → `alt="Hermes Switch UI"`
- **Line 479:** `Workspace` subtitle → `Switch UI`

### `src/components/auth/login-screen.tsx`
- **Line 64:** `Hermes Workspace` → `Hermes Switch UI`

### `src/components/connection-startup-screen.tsx`
- **Line 229:** `Hermes Workspace` → `Hermes Switch UI`
- **Line 258:** `Hermes Workspace works with any OpenAI-compatible backend.` → `Hermes Switch UI works with any OpenAI-compatible backend.`

### `src/components/onboarding/tour-steps.tsx`
- **Line 8:** `'Welcome to Hermes Workspace! ⚕'` → `'Welcome to Hermes Switch UI! ⚕'`
- **Line 77:** `'…without leaving Hermes Workspace.'` → `'…without leaving Hermes Switch UI.'`
- **Line 93:** `'Make Hermes Workspace yours.'` → `'Make Hermes Switch UI yours.'`
- **Line 101:** `'…customize Hermes Workspace to fit your workflow.'` → `'…customize Hermes Switch UI to fit your workflow.'`

### `src/components/onboarding/claude-onboarding.tsx`
- **Line 531:** `Welcome to Hermes Workspace` → `Welcome to Hermes Switch UI`

---

## 2) Public / Manifest / Browser Identity

### `public/manifest.json`
- **Line 2:** `"name": "Hermes Workspace"` → `"name": "Hermes Switch UI"`
- **Line 3:** `"short_name": "Hermes"` → `"short_name": "Switch UI"` (or keep `Hermes` if preferred)

### `public/index.html` (if it exists)
- Check `<title>` tag — update from `Hermes Workspace` to `Hermes Switch UI`

---

## 3) Electron App

### `electron/main.cjs`
- **Line 11:** `[hermes-workspace]` log prefix → `[hermes-switchui]`
- **Line 81:** `hermes-workspace version` → `hermes-switchui version`
- **Line 114:** `hermes-workspace ${version}` → `hermes-switchui ${version}`
- **Line 227:** `/tmp/hermes-workspace-gateway.log` → `/tmp/hermes-switchui-gateway.log`
- **Line 231:** `/tmp/hermes-workspace-dashboard.log` → `/tmp/hermes-switchui-dashboard.log`
- **Line 319:** `title: 'hermes-workspace'` → `title: 'Hermes Switch UI'`
- **Line 384:** `app.setName('hermes-workspace')` → `app.setName('hermes-switchui')`

---

## 4) Docker / Deployment

### `docker-compose.yml`
- **Line 1:** `# Hermes Workspace + Agent` → `# Hermes Switch UI + Agent`
- **Line 83:** `# The Hermes Workspace Web UI` → `# The Hermes Switch UI Web UI`
- Service names and image refs: check if `hermes-workspace` appears as container/image name and update to `hermes-switchui`

### `docker-compose.dev.yml`
- **Line 1:** `# Hermes Workspace — Development Overlay` → `# Hermes Switch UI — Development Overlay`

---

## 5) Top-Level Docs

### `README.md`
- Multiple mentions of `Hermes Workspace` in the header, fork description, and support sections. Replace product name references with `Hermes Switch UI`. Keep the upstream attribution line that credits `outsourc-e/hermes-workspace` as the original source.
- Docker section still references old image names — update.
- License section: `Inherited from upstream outsourc-e/hermes-workspace` — this is fine to keep as provenance.

### `CONTRIBUTING.md`
- **Line 1:** `# Contributing to Hermes Workspace` → `# Contributing to Hermes Switch UI`
- Update any internal product name references.

### `SECURITY.md`
- **Line 5:** `…vulnerability in Hermes Workspace` → `…vulnerability in Hermes Switch UI`
- **Line 9:** Update the security advisory URL if the repo has its own advisories page now. If not, keep the upstream URL but add a note.
- **Line 15:** `Hermes Workspace web application code` → `Hermes Switch UI web application code`

### `CLAUDE.md`
- **Line 24:** `opinionated flavor of Hermes Workspace` → `opinionated UI — Hermes Switch UI`
- **Line 29:** `canonical Hermes Workspace` — keep, this is upstream attribution
- **Line 30:** Sync strategy text is fine to keep

### `FEATURES-INVENTORY.md`
- **Line 1:** `# Hermes Workspace — Comprehensive Features Inventory` → `# Hermes Switch UI — Comprehensive Features Inventory`
- **Line 4:** `Desktop workspace for Hermes Agent` → `Desktop UI for Hermes Agent`
- **Line 688:** `hermes-workspace container` → `hermes-switchui container`
- **Line 739:** `_Generated from codebase analysis of /Users/aurora/hermes-workspace/_` → update path to current repo location

### `CHANGELOG.md`
- **Line 82:** `Hermes Workspace now runs on vanilla…` → `Hermes Switch UI now runs on vanilla…`
- Other historical entries: leave as-is (they describe the past accurately).

---

## 6) User-Facing Docs (`docs/`)

### `docs/docker.md`
- Heavy use of `Hermes Workspace` as a product name throughout. Replace all with `Hermes Switch UI`.
- `hermes-workspace` container name references → `hermes-switchui`
- Issue filing URL at the end: update from upstream to Switch UI repo if we have our own issues page.

### `docs/desktop-update-system.md`
- **Line 1:** `# Hermes Workspace Desktop Update System` → `# Hermes Switch UI Desktop Update System`
- **Line 9:** `Hermes Workspace: the UI/server shell` → `Hermes Switch UI: the UI/server shell`
- **Line 18:** `POST /api/update/workspace` — keep, this is a technical API route name

### `docs/claude-openai-compat-spec.md`
- **Line 1:** `# Hermes Workspace OpenAI-Compat Architecture Spec` → `# Hermes Switch UI OpenAI-Compat Architecture Spec`
- **Line 5:** `Make Hermes Workspace work out of the box` → `Make Hermes Switch UI work out of the box`
- Multiple other `Hermes Workspace` product name refs throughout — replace all.

### `docs/multi-gateway-pool-spec.md`
- **Line 2:** `## Hermes Workspace — Profile-Parallel Agent Execution` → `## Hermes Switch UI — Profile-Parallel Agent Execution`
- **Line 10:** `Hermes Workspace currently operates…` → `Hermes Switch UI currently operates…`
- Diagram label `Hermes Workspace UI` → `Hermes Switch UI`

### `docs/hermes-workspace-naming-contract.md`
- This entire doc is the old naming convention. Either:
  - Rename to `naming-contract.md` and update all `Hermes Workspace` → `Hermes Switch UI`
  - Or archive it and write a new Switch UI naming contract

### `docs/i18n-contributing.md`
- **Line 3:** `Hermes Workspace currently uses…` → `Hermes Switch UI currently uses…`

### `docs/AGENT-PAIRING.md`
- **Line 3:** `AI agents helping users set up Hermes Workspace` → `…set up Hermes Switch UI`
- **Line 11:** Diagram label `Hermes Workspace` → `Hermes Switch UI`

### `docs/troubleshooting.md`
- **Line 1:** `# Troubleshooting — Hermes Workspace` → `# Troubleshooting — Hermes Switch UI`

### `docs/agent-authored-ui-state.md`
- **Line 3:** `Hermes Workspace can render…` → `Hermes Switch UI can render…`

### `docs/Design Assets/` (HTML mockups)
- These are design reference files. Low priority but should be updated if they're still actively referenced.

---

## 7) Swarm Config

### `swarm.yaml`
- **Line 53:** `specialty: full-stack implementation across Hermes Workspace and Swarm2` → `…across Hermes Switch UI and Swarm2`

---

## 8) Graphify / Wiki

### `graphify-out/`
- Auto-generated — will update on next `graphify update .` run. Not a manual edit target.

### Code-reference wiki
- Already flagged as needing rename from `hermes-workspace-ui` to `hermes-switchui-wiki` or `switchui-code-ref`. Separate task.

---

## 9) NOT Changing

These are technical terms that happen to contain "workspace" and should be left alone:

- `workspace-shell.tsx` / `workspace-store.ts` — internal component/store names
- `workspace-overrides.json` — config file name
- `workspace-sessions.json` — auth session file
- `/api/workspace` — API route
- `useWorkspaceStore` — Zustand hook
- Comments about "workspace root directory" in file explorer logic
- CSS class names with `workspace` in them
- Any variable, function, or type name in source code

---

## Implementation Order

1. **App strings** (Section 1) — what users see on screen
2. **Manifest + Electron** (Sections 2–3) — browser title, app name, install identity
3. **Docker** (Section 4) — deployment identity
4. **Top-level docs** (Section 5) — README, CONTRIBUTING, SECURITY
5. **`docs/` folder** (Section 6) — spec docs and guides
6. **Remaining** (Sections 7–8) — swarm config, auto-generated content

Each slice is safe to ship independently. No code logic changes — only strings and prose.
