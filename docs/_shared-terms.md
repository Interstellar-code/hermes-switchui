# Shared terms — internal reference for doc authors

DO NOT add to manifest. Reference this when writing docs to keep labels/paths consistent.

## UI labels
- Settings → Model & Provider  (settings-dialog.tsx:74 — verified)
- Settings → Themes  (TODO: verify exact label)

## Env vars
- HERMES_API_URL — gateway URL, default http://127.0.0.1:8642
- HERMES_API_TOKEN — UI-side gateway auth token
- HERMES_PASSWORD — workspace UI password
- API_SERVER_HOST — agent bind interface (default 127.0.0.1)
- API_SERVER_KEY — agent-side auth token
- HOST — workspace bind interface (default 127.0.0.1)
- PORT — workspace port (default 3000)

## Paths
- ~/.hermes/                          — agent home
- ~/.hermes/.env                      — agent env file (CUSTOM_API_KEY etc.)
- ~/.hermes/workspace-sessions.json   — session tokens (legacy "workspace-" prefix; rebrand audit pending)
- ~/.hermes/workspace-overrides.json  — UI overrides (legacy "workspace-" prefix; rebrand audit pending)

## localStorage keys
- claude-theme  — selected theme (legacy "claude-" prefix; rebrand audit pending)

## Capability probe modes
- zero-fork (full feature set)
- enhanced-fork (partial features)
- portable (UI-only, no agent)
- disconnected (no agent reachable)
