# Swarm Feature Removal Report

**Date:** 2026-05-12
**Scope:** Remove all Swarm Mode functionality (tmux-backed multi-agent orchestration)
**Reason:** Unsustainable tmux-hack transport; replaced by native Hermes delegate_task + Kanban + Conductor/Operations page

---

## Summary

- **Files to DELETE:** ~65 files
- **Files to REFACTOR (remove swarm refs):** 17 files
- **Directories to DELETE:** 5 directories
- **Docs to DELETE:** 11 files
- **Auto-generated:** `routeTree.gen.ts` (regenerates after route deletion)

---

## Phase 1 — DELETE entire files/directories

### 1A. API Route Handlers (23 files)

```
src/routes/api/swarm-chat.ts
src/routes/api/swarm-checkpoint.ts
src/routes/api/swarm-decompose.ts
src/routes/api/swarm-direct-chat.ts
src/routes/api/swarm-dispatch.ts
src/routes/api/swarm-environment.ts
src/routes/api/swarm-health.ts
src/routes/api/swarm-kanban.ts
src/routes/api/swarm-lifecycle.ts
src/routes/api/swarm-memory.ts
src/routes/api/swarm-memory/search.ts
src/routes/api/swarm-missions.ts
src/routes/api/swarm-orchestrator-loop.ts
src/routes/api/swarm-project.ts
src/routes/api/swarm-reports.ts
src/routes/api/swarm-roster.ts
src/routes/api/swarm-runtime.ts
src/routes/api/swarm-tmux-scroll.ts
src/routes/api/swarm-tmux-start.ts
src/routes/api/swarm-tmux-stop.ts
```

### 1B. Route Tests (2 files)

```
src/routes/-swarm-routes.test.ts
src/routes/api/-swarm-dispatch.test.ts
```

### 1C. Route Pages (2 files)

```
src/routes/swarm.tsx
src/routes/swarm2.tsx
```

### 1D. Server Utilities (22 files)

```
src/server/swarm-chat-reader.ts
src/server/swarm-chat-reader.test.ts
src/server/swarm-checkpoints.ts
src/server/swarm-checkpoints.test.ts
src/server/swarm-environment.ts
src/server/swarm-foundation.ts
src/server/swarm-foundation.test.ts
src/server/swarm-kanban-store.ts
src/server/swarm-lifecycle.ts
src/server/swarm-memory.ts
src/server/swarm-memory.test.ts
src/server/swarm-missions.ts
src/server/swarm-missions.test.ts
src/server/swarm-mode.ts
src/server/swarm-mode.test.ts
src/server/swarm-model-resolver.ts
src/server/swarm-model-resolver.test.ts
src/server/swarm-notifications.ts
src/server/swarm-notifications.test.ts
src/server/swarm-profile-config.ts
src/server/swarm-profile-config.test.ts
src/server/swarm-roster.ts
```

### 1E. Screen Components — entire directories (2 dirs)

Delete entire directories:
```
src/screens/swarm/           (1 file: swarm-screen.tsx)
src/screens/swarm2/          (all files below)
```

swarm2 directory contents:
```
swarm2-activity-feed.tsx
swarm2-artifacts.tsx
swarm2-kanban-board.test.ts
swarm2-live-chat.tsx
swarm2-memory-panel.tsx
swarm2-orchestrator-card.tsx
swarm2-reports-view.tsx
swarm2-screen.tsx
swarm2-task-queue.tsx
swarm2-wires.tsx
```

### 1F. UI Components — entire directories (2 dirs)

Delete entire directories:
```
src/components/swarm/          (9 files: agent-card, router-chat, standalone-runtime-pane, swarm-compose, swarm-health-strip, swarm-node-chat, swarm-terminal, topology-band, widget-rail)
src/components/agent-swarm/    (6 files: activity-panel, agent-behaviors, agent-character, isometric-office, pixel-avatar, session-display-name)
```

### 1G. Hooks (1 file)

```
src/hooks/use-swarm-chat.ts
```

### 1H. Stores (1 file)

```
src/stores/agent-swarm-store.ts
```

### 1I. Individual components in shared directories (1 file)

```
src/components/agent-view/swarm-connection-overlay.tsx
```

### 1J. Documentation (11 files)

Delete entire directory:
```
docs/swarm/                   (ARCHITECTURE.md, QUICKSTART.md, README.md, ROLES.md, SKILLS.md)
```

Individual spec docs:
```
docs/swarm2-agent-ide-spec.md
docs/swarm2-autopilot-orchestration-spec.md
docs/swarm2-frankengpu-control-plane.md
docs/swarm2-memory-framework-spec.md
docs/swarm2-worker-lifecycle-compaction-spec.md
```

---

## Phase 2 — REFACTOR (remove swarm imports/refs from these files)

These are non-swarm files that import from or reference swarm modules. After Phase 1 deletion, these will have broken imports and must be patched.

### Navigation / Shell (5 files)

| File | What to remove |
|------|---------------|
| `src/components/workspace-shell.tsx` | Swarm nav items, swarm route links, swarm-related imports |
| `src/components/workspace-shell.test.ts` | Swarm-related test assertions |
| `src/components/mobile-hamburger-menu.tsx` | Swarm menu items |
| `src/components/mobile-tab-bar.tsx` | Swarm tab entries |
| `src/screens/chat/components/sidebar/v2/primary-nav-v2.tsx` | Swarm navigation link |

### Agent View (2 files)

| File | What to remove |
|------|---------------|
| `src/components/agent-view/agent-card.tsx` | Swarm session status display, swarm store imports |
| `src/components/agent-view/agent-view-panel.tsx` | Swarm connection overlay usage |

### Hooks (3 files)

| File | What to remove |
|------|---------------|
| `src/hooks/use-agent-behaviors.ts` | Swarm-specific behavior hooks |
| `src/hooks/use-agent-view.ts` | Swarm session polling |
| `src/hooks/use-sounds.ts` | Swarm-related sound triggers |

### Agents Screen (2 files)

| File | What to remove |
|------|---------------|
| `src/screens/agents/components/operations-agent-card.tsx` | Swarm dispatch/roster refs |
| `src/screens/agents/components/orchestrator-card.tsx` | Swarm orchestrator refs |

### Server (3 files)

| File | What to remove |
|------|---------------|
| `src/server/kanban-backend.ts` | Swarm Kanban store integration (swarm-kanban-store imports) |
| `src/server/kanban-backend.test.ts` | Swarm Kanban test references |
| `src/server/plugins-browser.ts` | Swarm plugin browser entries |

### Library (1 file)

| File | What to remove |
|------|---------------|
| `src/lib/orchestrator-identity.ts` | Swarm orchestrator identity logic |

### Auto-generated (1 file)

| File | Action |
|------|--------|
| `src/routeTree.gen.ts` | Auto-regenerates after route files deleted. Run `pnpm dev` or `pnpm build` to regenerate. Do NOT manually edit. |

---

## Phase 3 — Post-deletion verification

1. `rm -rf dist/` — clean build artifacts
2. `pnpm build` — verify no compile errors
3. `pnpm test` — verify no broken tests
4. Check for any runtime 404s on `/swarm` or `/swarm2` routes
5. Verify no sidebar/navigation dead links remain
6. Grep for any remaining `swarm` references: `grep -r 'swarm' src/ --include='*.ts' --include='*.tsx' -l`

---

## What NOT to delete

These files reference "swarm" but should be evaluated carefully — they may contain reusable logic for the Conductor/Operations page:

- `src/lib/orchestrator-identity.ts` — may have identity logic worth keeping
- `src/server/kanban-backend.ts` — core Kanban, just remove swarm-kanban-store integration
- `src/stores/task-store.ts` — references swarm store but is the core task store
- `src/screens/agents/components/orchestrator-card.tsx` — may be repurposed for Conductor

---

## Estimated Impact

- **Lines removed:** ~8,000-10,000 lines
- **API endpoints removed:** 18 endpoints
- **Bundle size reduction:** 2 swarm screen chunks + 9 component chunks
- **Runtime dependencies removed:** xterm.js (terminal), tmux binary requirement
