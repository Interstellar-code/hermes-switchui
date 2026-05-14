# Matrix3D — 3D Agent Workspace Page for Hermes SwitchUI

**Status:** Draft  
**Date:** 2026-05-13  
**Source:** [Claw3D](https://github.com/iamlukethedev/claw3d) (MIT license, v0.1.4)  
**Target:** `/matrix3d` route in Hermes SwitchUI

---

## What We're Adapting

Claw3D is a gateway-first Next.js app that renders a 3D office where AI agents appear as animated workers. It has a bundled Hermes adapter that translates the Claw3D gateway WebSocket protocol into Hermes HTTP API calls. We're extracting the 3D workspace concept and the Hermes adapter into a first-class SwitchUI page.

### What Claw3D provides (worth keeping)
- **3D Office Scene** — Three.js + React Three Fiber + Drei retro-office where agents walk, idle, and interact
- **Hermes Gateway Adapter** (`server/hermes-gateway-adapter.js`) — WebSocket server that bridges Claw3D gateway protocol to Hermes HTTP API, supports multi-agent orchestration (spawn, delegate, dismiss, list team)
- **Agent Registry** — Tracks spawned sub-agents with their own conversation history, sessions, and state
- **Gateway Protocol** — Event-driven: `chat`, `presence`, `heartbeat`, `cron` events; methods for agents, sessions, approvals, config, skills, models, tasks, cron
- **Office Builder** — `/office/builder` for editing layouts (Phaser-based)

### What we don't need
- OpenClaw gateway support (we're Hermes-only)
- Docker infrastructure / standalone server deployment
- The custom Node server (`server/index.js`) — SwitchUI has its own Express/Vite dev server
- Demo gateway adapter
- The full Next.js App Router app shell

---

## Architecture Decision: Embed vs. Standalone

**Embed in SwitchUI** (recommended). Reasons:
1. Single process, single port — no separate `hermes-adapter` WebSocket server to manage
2. Direct access to SwitchUI stores (workspace, session, chat) — no gateway protocol translation needed
3. The 3D canvas renders as a React component inside the existing TanStack Router layout
4. Agent state comes from Hermes API routes already present in `/api/*`

The Claw3D Hermes adapter's WebSocket protocol becomes an **internal API layer** rather than an external process. The 3D scene subscribes to session events via the existing `chat-event-bus.ts` and renders agents based on session/agent state.

---

## Implementation Plan

## Phase 1 — As Shipped (2026-05-13)

Phase 1 landed pragmatically with file consolidation vs the original plan. Actual structure:

| Plan called for | Actually shipped | Note |
|---|---|---|
| `office-scene.tsx`, `office-room.tsx`, `office-lighting.tsx`, `agent-avatar.tsx` (4 separate files) | `components/matrix3d-canvas.tsx` (181 lines, one file) | Consolidated for Phase 1 simplicity. Will split when Phase 2 introduces interaction. |
| `agent-panel.tsx` | Not yet shipped | Phase 2 |
| `hooks/use-agent-positions.ts`, `hooks/use-office-state.ts` | Not yet shipped | Phase 2 |
| `package.json` add three / R3F / Drei | Already present in package.json | No new deps needed (three, @react-three/fiber, @react-three/drei, @react-three/postprocessing, @react-three/rapier, ecctrl all already installed) |
| nav entry, tab index, mobile tab | All wired (primary-nav-v2, workspace-shell, mobile-tab-bar) | Done |

**Files in repo (uncommitted as of revision):**
- `src/routes/matrix3d.tsx` (13 lines)
- `src/screens/matrix3d/matrix3d-screen.tsx` (121 lines — hero header, status pills, "what shipped" sidebar)
- `src/screens/matrix3d/components/matrix3d-canvas.tsx` (181 lines — Canvas, 4 desks, capsule avatars, Matrix rain bars, OrbitControls, fog, green lighting)
- `src/screens/chat/components/sidebar/v2/primary-nav-v2.tsx` (modified — isometric cube icon, Main group, after Operations)
- `src/components/workspace-shell.tsx` (modified — tab index mapping)
- `src/components/mobile-tab-bar.tsx` (modified — Building01Icon mobile tab)

**Known TypeScript leftovers:**
- 2 pre-existing errors in `text-shimmer.tsx` (unrelated)
- 1 implicit `any` in matrix3d-canvas.tsx (resolves with `@types/three` install — harmless at runtime)

**Phase 2 should treat the above as the new baseline and split `matrix3d-canvas.tsx` only when interaction demands it.**

---

### Phase 1: Foundation (deps + route + shell)

**1.1 — Add Three.js dependencies**
```bash
pnpm add three @react-three/fiber @react-three/drei
pnpm add -D @types/three
```
These are the core rendering stack Claw3D uses. No Phaser — office builder is Phase 3+.

**1.2 — Create route file** `src/routes/matrix3d.tsx`
- TanStack file-route pattern, same as existing pages
- Lazy-loads the 3D scene (code-split, ~200KB three.js bundle)
- Route: `/matrix3d`

**1.3 — Create screen directory** `src/screens/matrix3d/`
```
src/screens/matrix3d/
  matrix3d-screen.tsx          # Page shell with error boundary + Suspense
  components/
    office-scene.tsx           # R3F Canvas wrapper
    agent-avatar.tsx           # 3D agent character (idle/walking states)
    office-room.tsx            # Static office geometry (desks, walls, props)
    office-lighting.tsx        # Lighting rig
    agent-panel.tsx            # Side panel for selected agent details
  hooks/
    use-agent-positions.ts     # Maps session state to 3D positions
    use-office-state.ts        # Manages office layout + agent presence
```

**1.4 — Register in primary nav** (`primary-nav-v2.tsx`)
- Add `matrix3d` icon to `ICONS` constant (cube/isometric shape)
- Add `<NavItem>` in a new **WORKSPACE** group between Main and Knowledge:
  ```
  KNOWLEDGE → WORKSPACE → Main
  ```
  or under Main after Operations. Decision point — see Open Questions.

**1.5 — Register in workspace shell** (`workspace-shell.tsx`)
- Add tab index mapping for `/matrix3d` in `getTabIndex()`
- Handle mobile tab bar entry

### Phase 2: 3D Scene + Agent Visualization

**2.1 — Office Scene base** (`office-scene.tsx`)
- `Canvas` from `@react-three/fiber`
- Camera: isometric-ish angle (OrbitControls from Drei)
- Background: dark Matrix-green tinted grid floor, matching SwitchUI theme
- Suspense fallback: wireframe loading cube

**2.2 — Static office geometry** (`office-room.tsx`)
- Adapt from Claw3D's office layout: desks, monitors, walls
- Simplified: we don't need full Claw3D office complexity. Start with:
  - 1 main room, 4-6 desk positions
  - Each desk = `DeskUnit` component (table + monitor + chair)
  - Dark theme materials matching SwitchUI's `--theme-*` vars

**2.3 — Agent Avatar** (`agent-avatar.tsx`)
- Simple capsule/box character with name label (Text from Drei)
- Two animation states: idle (subtle bob), active (walking in place)
- Color coded by agent status (green = active, gray = idle, red = error)
- Position determined by desk assignment

**2.4 — Agent position hook** (`use-agent-positions.ts`)
- Polls Hermes API for active sessions (`/api/sessions`)
- Maps each active session to a desk position
- Handles position conflicts (multiple agents → spread across desks)
- Returns `Map<sessionId, { position, status, name }>`

**2.5 — Agent detail panel** (`agent-panel.tsx`)
- Right-side drawer when an agent is clicked
- Shows: agent name, session key, current task, tool usage, status
- Reuses existing drawer patterns from `task-detail-drawer.tsx`

### Phase 3: Multi-Agent Orchestration — Detailed Plan

**Full plan:** `docs/plans/matrix3d-phase3-orchestration.md`

Key insight: no new backend routes needed. SwitchUI already has `/api/sessions` (CRUD), `/api/session-send` (fire-and-forget messaging), `/api/chat-events` (SSE). Phase 3 is entirely frontend.

**5 Milestones (sequential):**
- **M1** — Agent spawn modal: create session from 3D page, spawn-in animation
- **M2** — Agent dismiss: end session with confirm flow, fade-out animation
- **M3** — Message delegation: send messages to sessions from detail panel, session history preview
- **M4** — Right-click context menu: View Session / Send Message / End Session
- **M5** — Live activity visuals: processing pulse, tool-call flash, error state

**Files:** 4 new, 6 modified, 0 new API routes. Zustand store extended with spawn, dismiss, messaging, context menu, and activity state.

### Phase 4: Polish & Office Customization

**4.1 — Office layout persistence**
- Store layout in `workspace-store` or localStorage
- Allow desk rearrangement (drag & drop with Drei)

**4.2 — Matrix theme integration**
- Green particle rain effect (lightweight, CSS-based overlay)
- Sound effects optional (configurable)
- Terminal-style HUD overlays on agent monitors

**4.3 — Performance guardrails**
- `frameloop="demand"` when tab not focused
- Limit rendered agents to viewport
- LOD for distant agents
- WebWorker for position calculations if >20 agents

---

## File Touch List (Phase 1-2)

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | modify | Add three, @react-three/fiber, @react-three/drei, @types/three |
| `src/routes/matrix3d.tsx` | create | Route definition |
| `src/screens/matrix3d/matrix3d-screen.tsx` | create | Page shell |
| `src/screens/matrix3d/components/office-scene.tsx` | create | R3F Canvas |
| `src/screens/matrix3d/components/agent-avatar.tsx` | create | Agent 3D model |
| `src/screens/matrix3d/components/office-room.tsx` | create | Static geometry |
| `src/screens/matrix3d/components/agent-panel.tsx` | create | Detail drawer |
| `src/screens/matrix3d/hooks/use-agent-positions.ts` | create | Session→position map |
| `src/screens/chat/components/sidebar/v2/primary-nav-v2.tsx` | modify | Add nav entry |
| `src/components/workspace-shell.tsx` | modify | Add tab index |
| `src/components/mobile-tab-bar.tsx` | modify | Add mobile tab (if visible on mobile) |

---

## Key Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Three.js bundle size (~200KB gzipped) | Page load | Lazy-load entire `/matrix3d` route with React.lazy |
| WebSocket adapter complexity | Dev time | Skip adapter, use direct Hermes API calls. Adapter protocol is over-engineered for embedded use |
| Mobile performance | Poor UX on phones | Show 2D fallback or disable on mobile viewport |
| Claw3D license changes | Fork risk | MIT license as of v0.1.4. Vendored, not npm-depended — we control the code |

---

## Open Questions (decided)

1. ✅ **Nav placement** — Main group, after Operations. Shipped in Phase 1.
2. ✅ **Scope of Phase 1 MVP** — static office + visual presence only. No orchestration. Shipped.
3. ✅ **Mobile strategy** — Phase 1 ships mobile tab entry. Phase 2 must add 2D fallback for low-power devices and WebGL unavailability (see Clarifications #4 / #5).
4. **Claw3D office assets** — DECIDED: recreate simplified versions. Phase 1 already does this with primitive geometry; do not import Claw3D model files.
5. **Agent count cap** — DECIDED: 16 simultaneous active avatars before degraded mode (label-only, no animation). See Clarifications #7 performance budget.

---

## Design Clarifications (post-review)

These resolve the 12 gaps from Codex/internal review of the original draft. Phase 2 onward must respect these.

### 1. Avatar data contract

One avatar = one **active Hermes session** under a non-default profile. Source of truth:
- list: GET `/api/sessions` filtered by `status in ('running', 'idle')`
- subscribe: `chat-event-bus.ts` SSE (NOT polling) — see Clarification #2
- key: `sessionKey`
- profile: `session.profile` (string; maps to a desk seat — see #6)
- status: `session.status` → avatar color (green=running, gray=idle, red=error)

When Phase 3 lands and adds A2A inbound tasks, those will spawn **ephemeral avatars** keyed by `a2a_task_id` (see Phase 5). Until then, avatar set = active sessions only.

### 2. SSE over polling — no `/api/sessions` poll loop

`use-agent-positions.ts` MUST subscribe to `chat-event-bus.ts` SSE events, not poll. Events of interest: `session.started`, `session.ended`, `session.status-changed`, `session.error`. Polling fallback only if SSE bus is unavailable (network or feature-flag off), throttle to 10 seconds in that case. Document the SSE event names this hook consumes.

### 3. Accessibility — keyboard + screen-reader path

3D-only navigation fails WCAG. Phase 2 ships:
- Tab navigation through avatars (focus ring inside canvas via Drei `<Html>` overlay)
- `aria-label` per avatar (profile name + status)
- Enter/Space opens detail panel for focused avatar
- Hidden HTML list mirroring same avatars (visible via "List View" toggle button); `role="region"` `aria-label="Active agent roster"`
- Screen-reader announces avatar status changes via `aria-live="polite"` region

### 4. WebGL fallback — must not whitescreen

Detect WebGL support before mounting Canvas. If unavailable:
- Render a 2D HTML grid: cards per active session with status pill, name, current task
- Show banner: "3D view unavailable in this browser; falling back to list."
- Hide OrbitControls help text

Use `WebGLRenderer.isWebGL2Available()` check or equivalent feature probe. Implementation in `matrix3d-screen.tsx`, gates Canvas mount.

### 5. Mobile responsiveness

Below 768px viewport: default to 2D fallback (same as Clarification #4). User can opt into 3D via a settings toggle but warned about performance. Reasoning: most mobile devices choke on 16-avatar R3F scenes.

### 6. Desk seat assignment

Profile → desk position must be stable across renders so an avatar doesn't teleport when another session ends. Algorithm:
- Sort active session list by `profile` (alphabetical)
- Assign desk seats in fixed order (top-left, top-right, ...)
- Cache assignment in `use-agent-positions.ts` until session ends
- When session count exceeds desk count (currently 4), spillover avatars sit on the floor near the back wall in a row; Phase 4 may add more desks

### 7. Performance budget

| Metric | Target | Measure when |
|---|---|---|
| FPS on M1 Mac, idle scene | ≥58 | Phase 2 PR |
| FPS on M1 Mac, 16 active avatars | ≥45 | Phase 3 PR |
| Max draw calls per frame | ≤120 | Phase 2 PR |
| First-paint to Canvas mounted | <800ms after route activation | Phase 2 PR |
| Bundle size delta (gzipped) | <500KB on top of base SwitchUI | Phase 2 PR |
| Memory growth over 10min idle | <20MB | Phase 4 PR |

Use Chrome DevTools Performance recorder + spector.js for draw-call counting. Document baseline in each PR.

### 8. Bundle size correction

Original plan claimed "~200KB three.js." Actual: with three + @react-three/fiber + @react-three/drei + @react-three/postprocessing, typical gzipped weight is 400-500KB. Plan target is now <500KB delta (Clarification #7). Verify with bundle analyzer in Phase 2 PR; if exceeded, prune Drei subimports.

### 9. R3F memory-leak prevention checklist

Phase 2 component PRs MUST satisfy:
- `useFrame` callbacks: no stale closures over React state; use refs for mutable values
- All `<Canvas>` children with Texture loads dispose textures on unmount (Drei `useTexture` handles this; raw `TextureLoader` does not)
- OrbitControls listeners are cleaned up by `<OrbitControls>` Drei component automatically — but custom event listeners on `<Canvas>` (resize, visibility) must be removed in effect cleanup
- Geometry/Material disposal: when avatars unmount due to session-ended, dispose `mesh.geometry.dispose()` + `mesh.material.dispose()` — Drei components handle this; raw mesh construction does not
- `frameloop="demand"` when tab not focused (use `document.visibilitychange` listener)

Add as a checklist in the Phase 2 PR template.

### 10. Reconcile WebGL rain vs CSS rain

Phase 1 shipped Matrix rain bars **inside R3F Canvas** (WebGL). The original Phase 4.2 mentioned "CSS-based green particle rain overlay." DECISION: keep the WebGL rain in Canvas, REMOVE the planned CSS overlay. Less code, single rendering pipeline, GPU-cost already paid. Update Phase 4 accordingly.

### 11. Interaction model

| Input | Result |
|---|---|
| Left-click avatar | Open detail drawer (right side) |
| Hover avatar | Tooltip with name + status |
| Right-click avatar | Context menu (Phase 3): View Session, Send Message (A2A), End Session |
| Tab key | Focus next avatar |
| Enter on focused avatar | Same as left-click |
| Drag desk (Phase 4 only) | Reposition desk; persist in workspace-store |
| Scroll inside canvas | OrbitControls zoom |
| Right-drag inside canvas | OrbitControls pan |
| Left-drag empty space | OrbitControls rotate |

Click on empty space dismisses the open detail drawer.

### 12. Cross-link to A2A plugin (Phase 5 preview)

When the hermes-agent A2A plugin lands (see `~/.hermes/hermes-agent/docs/plans/2026-05-13-a2a-plugin-mvp-plan.md`), inbound A2A tasks will create ephemeral remote-caller avatars in the 3D office. These will:
- Render with a distinct visual (e.g., translucent halo + "incoming" label)
- Position at the office entrance, walk to the desk of the target profile, deliver the message
- Disappear when the task completes
- Show the caller's `from_agent` field as the label

Phase 5 is out of scope for now but the avatar data contract (Clarification #1) reserves an `origin: 'local' | 'a2a-inbound'` field to avoid a breaking change later.

---

## Source Reference

- Claw3D repo: `https://github.com/iamlukethedev/claw3d`
- Hermes adapter source: `server/hermes-gateway-adapter.js`
- Architecture doc: `ARCHITECTURE.md`
- Runtime profiles: `docs/runtime-profiles.md`
- Gateway protocol: `docs/hermes-gateway.md`
