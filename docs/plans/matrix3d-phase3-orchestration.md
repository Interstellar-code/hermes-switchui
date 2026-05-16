# Matrix3D Phase 3 — Multi-Agent Orchestration

**Status:** Draft  
**Date:** 2026-05-14  
**Branch:** `feat/matrix3d-phase3` (from `feat/matrix3d-phase2`)  
**Worktree:** `hermes-switchui-matrix3d`  
**Depends on:** Phase 2 (commit `e77ceae0`)  

---

## What Phase 2 Gave Us

10 files in `src/screens/matrix3d/`:

| File | Purpose |
|------|---------|
| `matrix3d-screen.tsx` | Page shell, WebGL detection, 2D fallback, hero header |
| `matrix3d-store.ts` | Zustand — `selectedAgentId`, `selectAgent`, `deselectAgent` |
| `components/matrix3d-canvas.tsx` | Thin R3F scene orchestrator |
| `components/office-room.tsx` | Floor, walls, platform, grid |
| `components/office-lighting.tsx` | Green-tinted lighting rig |
| `components/agent-avatar.tsx` | Capsule with click, bob, Float, status color |
| `components/desk.tsx` | Standalone desk unit |
| `components/matrix-rain.tsx` | WebGL rain bars |
| `components/agent-detail-panel.tsx` | Right drawer: name, status, metrics, session info |
| `hooks/use-agent-positions.ts` | SSE-subscribed session list → sorted desk positions |

What it **doesn't** do (yet):
- No write operations — read-only view of sessions
- No agent spawn / dismiss from the 3D surface
- No message delegation from the detail panel
- No visual feedback when a session is actively processing (beyond bob speed)
- No context menu on avatars
- No confirmation flows for destructive actions

---

## Architecture: How Claw3D Does It vs. What We Need

### Claw3D's approach (WebSocket gateway adapter)
Claw3D uses a separate Node.js WebSocket server (`hermes-gateway-adapter.js`, 1279 lines) that:
- Registers `spawn_agent`, `delegate_task`, `dismiss_agent`, `list_team`, `configure_agent`, `read_agent_context` as LLM function tools
- The orchestrator agent calls these tools during conversation
- The adapter translates tool calls into Hermes HTTP API calls
- Agents are tracked in an in-memory `teamAgents` Map

### Our approach (embedded, no gateway adapter)
We don't need a WebSocket adapter because:
1. SwitchUI already has the backend API routes — `/api/sessions` (GET/POST/DELETE), `/api/session-send` (POST), `/api/start-agent` (POST)
2. SwitchUI has `chat-event-bus.ts` — a singleton pub/sub that fans SSE events to browser clients
3. SwitchUI has `session-send.ts` — fire-and-forget message delivery to any session

So Phase 3 orchestration is a **frontend-only** feature. We wire the existing API routes into new UI surfaces inside the Matrix3D page. No new backend code needed.

---

## Phase 3 Scope — 5 Milestones

### M1: Agent Spawn Modal + API Integration

**Goal:** User can create a new session directly from the Matrix3D page.

**Files:**
- **NEW** `src/screens/matrix3d/components/spawn-agent-modal.tsx`
- **MODIFY** `src/screens/matrix3d/matrix3d-store.ts` — add `isSpawnModalOpen`, `openSpawnModal`, `closeSpawnModal`
- **MODIFY** `src/screens/matrix3d/matrix3d-screen.tsx` — add "+" spawn button to hero bar, render `<SpawnAgentModal>`
- **MODIFY** `src/screens/matrix3d/components/agent-avatar.tsx` — brief spawn-in animation (scale 0→1 over 400ms) when new agent appears

**SpawnAgentModal fields:**
- **Name** (required) — session label
- **Model** (optional) — dropdown from `/api/models`
- **Initial message** (optional) — first prompt to send after creation

**API flow:**
1. `POST /api/sessions` → `{ sessionKey, friendlyId }`
2. If initial message provided: `POST /api/session-send` with `{ sessionKey, message }`
3. Avatar appears in scene (SSE `session-started` triggers `useAgentPositions` refetch)

**Spawn-in animation:**
- New avatar scales from 0→1 over 400ms with `easing: easeOutBack`
- Detect "new" agents by comparing previous agent list to current (use a `prevAgents` ref)

---

### M2: Agent Dismiss + Session End

**Goal:** User can terminate a session from the 3D scene.

**Files:**
- **MODIFY** `src/screens/matrix3d/matrix3d-store.ts` — add `confirmDismissId`, `requestDismiss`, `cancelDismiss`, `confirmDismiss`
- **NEW** `src/screens/matrix3d/components/dismiss-confirm.tsx` — inline confirmation popover
- **MODIFY** `src/screens/matrix3d/components/agent-detail-panel.tsx` — add "End Session" button in footer
- **MODIFY** `src/screens/matrix3d/components/agent-avatar.tsx` — fade-out animation (scale 1→0, opacity 1→0 over 300ms) before removal

**API flow:**
1. User clicks "End Session" in detail panel → `requestDismiss(id)`
2. Inline confirmation popover appears: "End session for {name}? This cannot be undone."
3. Confirm → `DELETE /api/sessions?sessionKey={id}`
4. Avatar plays fade-out, then `useAgentPositions` refetch removes it

**Dismiss animation:**
- Track `exiting` agents in `matrix3d-store` as `Set<string>`
- Avatar checks if its ID is in `exiting` set → renders exit animation instead of normal
- On animation complete, removal happens naturally via refetch

---

### M3: Message Delegation from Detail Panel

**Goal:** User can send a message to any agent's session from the detail drawer.

**Files:**
- **MODIFY** `src/screens/matrix3d/components/agent-detail-panel.tsx` — add message input + send button in footer area, show last 5 messages from session history
- **NEW** `src/screens/matrix3d/hooks/use-session-history.ts` — fetch `/api/session-history?sessionKey={id}&limit=5`
- **MODIFY** `src/screens/matrix3d/matrix3d-store.ts` — add `sendingMessage`, `sendAgentMessage(id, text)`

**API flow:**
1. User types message in input → `POST /api/session-send` with `{ sessionKey, message }`
2. Response is fire-and-forget (`{ ok: true, queued: true }`)
3. Poll `use-session-history` every 5s while panel is open to pick up assistant reply
4. Avatar animation intensifies while processing (bob speed increases, emissive pulse)

**Session history display:**
- Show last 5 messages in a scrollable mini-chat inside the detail panel
- User messages: right-aligned, green accent
- Assistant messages: left-aligned, neutral
- Auto-scroll to bottom on new messages
- "View Full Session" link that navigates to `/chat?session={sessionKey}`

---

### M4: Right-Click Context Menu

**Goal:** Right-click on avatar shows context menu with quick actions.

**Files:**
- **NEW** `src/screens/matrix3d/components/agent-context-menu.tsx`
- **MODIFY** `src/screens/matrix3d/components/agent-avatar.tsx` — add `onContextMenu` handler
- **MODIFY** `src/screens/matrix3d/matrix3d-screen.tsx` — render `<AgentContextMenu>` at mouse position, manage open/close state

**Context menu items:**
1. **View Session** → navigate to `/chat?session={sessionKey}`
2. **Send Message** → open detail panel + focus message input
3. **End Session** → trigger dismiss flow (M2)

**Implementation:**
- Context menu is an HTML overlay (not 3D) positioned at `clientX/clientY`
- Click outside dismisses
- Escape key dismisses
- Styled with Matrix theme (dark card, green border accent)

---

### M5: Live Activity Visual Feedback

**Goal:** Avatars visually reflect their real-time processing state beyond just bob speed.

**Files:**
- **MODIFY** `src/screens/matrix3d/components/agent-avatar.tsx` — add processing state visuals
- **MODIFY** `src/screens/matrix3d/hooks/use-agent-positions.ts` — track per-agent activity state from SSE events
- **MODIFY** `src/screens/matrix3d/matrix3d-store.ts` — add `agentActivity` Map tracking last event per agent

**Visual feedback levels:**

| State | Visual |
|-------|--------|
| `idle` | Slow bob, muted glow |
| `active` | Fast bob, bright emissive |
| `processing` | Fast bob + pulsing ring + particle burst from desk monitor |
| `tool-call` | `processing` + brief screen flash on desk monitor area |
| `error` | Red pulse, bob pauses briefly |

**SSE events consumed:**
- `message-complete` → agent was processing, now `active`
- `tool-call` → brief `tool-call` state (1.5s)
- `session-status-changed` → update status
- `session-error` → `error` state

**Activity tracking:**
- `use-agent-positions` already subscribes to SSE
- Extend to maintain `agentActivity: Map<string, { lastEvent: string, timestamp: number }>`
- Pass activity state to `AgentAvatar` as a prop

---

## Zustand Store Extensions (Full Shape)

```typescript
export type Matrix3DState = {
  // — Existing (Phase 2) —
  selectedAgentId: string | null
  
  // — M1: Spawn —
  isSpawnModalOpen: boolean
  
  // — M2: Dismiss —
  confirmDismissId: string | null
  exitingAgentIds: Set<string>
  
  // — M3: Messaging —
  sendingMessage: boolean
  
  // — M4: Context Menu —
  contextMenu: { agentId: string; x: number; y: number } | null
  
  // — M5: Activity —
  agentActivity: Map<string, { lastEvent: string; timestamp: number }>
}

export type Matrix3DActions = {
  // — Existing —
  selectAgent: (id: string) => void
  deselectAgent: () => void
  
  // — M1 —
  openSpawnModal: () => void
  closeSpawnModal: () => void
  
  // — M2 —
  requestDismiss: (id: string) => void
  cancelDismiss: () => void
  confirmDismiss: () => void
  markExiting: (id: string) => void
  clearExiting: (id: string) => void
  
  // — M3 —
  sendAgentMessage: (sessionKey: string, text: string) => Promise<void>
  
  // — M4 —
  openContextMenu: (agentId: string, x: number, y: number) => void
  closeContextMenu: () => void
  
  // — M5 —
  updateActivity: (agentId: string, event: string) => void
}
```

---

## File Touch List

| File | Action | Milestone |
|------|--------|-----------|
| `matrix3d-store.ts` | modify (add spawn, dismiss, messaging, context, activity state) | M1–M5 |
| `matrix3d-screen.tsx` | modify (spawn button, context menu, spawn modal) | M1, M4 |
| `components/spawn-agent-modal.tsx` | **create** | M1 |
| `components/dismiss-confirm.tsx` | **create** | M2 |
| `components/agent-context-menu.tsx` | **create** | M4 |
| `components/agent-detail-panel.tsx` | modify (dismiss button, message input, session history) | M2, M3 |
| `components/agent-avatar.tsx` | modify (spawn-in, fade-out, activity visuals) | M1, M2, M5 |
| `hooks/use-agent-positions.ts` | modify (activity tracking) | M5 |
| `hooks/use-session-history.ts` | **create** | M3 |

**Totals:** 4 new files, 6 modified files, 0 new API routes.

---

## Interaction Model (Updated from Plan Clarification #11)

| Input | Result |
|-------|--------|
| Left-click avatar | Open detail drawer (right side) |
| Hover avatar | Tooltip with name + status (existing) |
| **Right-click avatar** | **Context menu: View Session / Send Message / End Session** (M4) |
| Tab key | Focus next avatar (existing) |
| Enter on focused avatar | Same as left-click (existing) |
| **"+" button in hero bar** | **Open spawn modal** (M1) |
| **"End Session" in detail panel** | **Inline confirm → DELETE session** (M2) |
| **Message input in detail panel** | **Send message to session** (M3) |
| Click empty space | Dismiss panel + context menu |
| Scroll/left-drag/right-drag | OrbitControls (existing) |

---

## Execution Order

**M1 → M2 → M3 → M4 → M5** (strict sequential)

Reasoning:
- M1 (spawn) establishes the write-path pattern and spawn-in animation
- M2 (dismiss) builds on the same pattern with exit animation + confirmation UX
- M3 (messaging) adds the session-history read path + message input
- M4 (context menu) is a UI shortcut that reuses M1–M3 actions
- M5 (live visuals) is polish that depends on having all actions working

Each milestone produces a working, testable state. If we need to cut scope, M1–M3 give us the core loop; M4–M5 are enhancements.

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| `session-send` fire-and-forget may silently fail | User thinks message sent, nothing happens | M3 polls session-history — if no reply after 10s, show "Message may not have been delivered" warning |
| Spawn creates session but SSE doesn't fire `session-started` | Avatar doesn't appear | `useAgentPositions` has 30s safety poll + explicit refetch after spawn API returns |
| Dismiss during active processing | Session terminated mid-stream | Confirm dialog warns; API handles gracefully |
| Context menu position goes off-screen | Menu clipped or invisible | Clamp position to viewport bounds |
| Too many SSE events cause excessive refetches | Performance degradation | Debounce refetches to 500ms; batch activity updates |

---

## Performance Budget (from Plan Clarification #7)

| Metric | Target | Verify at |
|--------|--------|-----------|
| FPS idle scene (M1 Mac) | ≥58 | M5 PR |
| FPS 16 active avatars | ≥45 | M5 PR |
| Max draw calls per frame | ≤120 | M5 PR |
| Context menu render | <16ms | M4 PR |
| Message send → UI feedback | <200ms | M3 PR |
| Spawn → avatar visible | <2s | M1 PR |

---

## Phase 4 Preview (Not in Scope)

Phase 4 (from original plan) covers:
- Office layout persistence (drag desks, save in workspace-store)
- Matrix theme polish (sound effects, terminal HUD on monitors)
- Performance guardrails (demand render, LOD, WebWorker for >20 agents)

These are separate from orchestration and can be done independently after Phase 3 ships.
