# Workspace terminal layout and profile scope plan

## Goal

Keep the persistent terminal available without covering non-chat workspaces,
add explicit Hermes profile selection to the per-profile Projects workspace,
and make Tasks assignee filtering compact and URL-addressable. Boards remain a
single host-global Kanban surface.

## Scope and contracts

- `WorkspaceShell` owns the persistent terminal overlay. Non-chat route content
  must reserve its panel height; Chat keeps its existing composer-aware inset.
- Projects are stored per Hermes profile. The selected profile is carried in
  `/projects?profile=<name>`, query keys, proxy requests, and mutations. A
  failed explicit profile request must not fall back to the active profile.
- Kanban Tasks and Boards use the shared `kanban.db`. Tasks expose an
  **Assignee profile** filter (the task's `assignee`), not profile-scoped data.
  Boards remain global and receive a scope label rather than a misleading
  profile selector.

## Implementation order

1. Shell layout and Tasks height regression.
2. Projects profile route/search, UI selector, API client routing, and tests.
3. Tasks assignee dropdown and URL synchronization.
4. Boards global-scope label.
5. Focused tests, lint, full tests, and production build.

## Acceptance criteria

- Opening the desktop terminal panel never causes Tasks, Boards, Projects,
  Files, or Settings content to render underneath it.
- Chat behavior and terminal persistence remain unchanged.
- Changing Projects profile updates the URL, closes stale project UI, refetches
  the selected profile, and sends all mutations to that profile.
- Refreshing `/projects?profile=<name>` preserves the selected profile.
- Tasks selection uses `/tasks?assignee=<name>`, supports `All profiles`, and
  does not add profile routing to Kanban requests.
- Boards visibly communicates that the dataset is global.
- Existing unscoped behavior remains byte-compatible where applicable.

## Non-goals

- No Hermes Agent backend changes: Projects already accepts `profile=`, while
  Kanban explicitly remains host-global.
- No new shared dropdown abstraction until a second genuinely shared behavior
  exists.
