# Rebrand audit flags — internal

Docs referencing legacy "workspace-" or "claude-" identifiers that are still active in code. Update both code AND docs when the rebrand pass happens.

## File references
- docs/faq.md — mentions workspace-sessions.json, workspace-overrides.json
- docs/troubleshooting/agent-connect.md — (verify if any references; update if yes)

## localStorage keys
- docs/faq.md — references claude-theme key
- docs/customization/themes.md — likely will reference claude-theme when written

## Code paths still using legacy names (for cross-reference)
- src/server/auth-middleware.ts:20,28
- src/server/gateway-capabilities.ts:37
- src/lib/theme.ts:81
- src/routes/__root.tsx:49
