# Profiles Revamp — Config Schema (gateway-aligned)

Reference for `~/.hermes/profiles/<name>/config.yaml` extended shape.

Gateway uses `yaml.safe_load` + `_deep_merge(DEFAULT_CONFIG, user_yaml)`.
**No pydantic, no strict schema — unknown keys silently tolerated.**
All fields below are optional; legacy profiles without any new keys continue to parse correctly.

```yaml
# — Gateway-functional keys (gateway reads + acts on these) —
description: "TypeScript Architect"           # display name; tolerated by gateway
system_prompt: |                              # frozen persona snapshot — fully honored
  You are a TypeScript Architect...
model:
  default: claude-sonnet-4-6
  provider: anthropic
mcp_servers:                                  # per-profile MCP allowlist (dict, not array)
  context-mode:
    url: https://...
  filesystem:
    command: npx
    args: ["@modelcontextprotocol/server-filesystem", "..."]
skills:
  external_dirs: ["/Users/me/.hermes-shared/skills"]  # extra dirs; profile's `skills/` auto-scanned
memory:
  memory_enabled: true
  provider: hindsight                         # hindsight|mem0|openviking|holographic|retaindb|byterover
toolsets: ["core", "files", "web"]
agent:
  max_turns: 200
  reasoning_effort: medium                    # low|medium|high
  disabled_toolsets: []

# — UI-only metadata (gateway tolerates as unknown keys) —
agent_ui:                                     # namespaced to avoid collision with gateway `agent:`
  tier: 3                                     # 1|2|3 — only 3 is user-writable
  glyph: "TS"                                 # 1-3 char display token
  role: "TypeScript Architect"
  status: "draft"                             # draft|idle|active (P0–P5 always "draft" on create)
  tags: ["typescript", "review"]
  persona_id: "engineering-typescript-architect"
  last_run: null                              # populated by P6 derivation
```

## Dropped from initial scope

- `temperature` / `max_tokens` — gateway change required; deferred to upstream feature request.
- `memory.scope` / `memory.auto_summarize` — gateway only honors `memory_enabled` + `provider`; revisit if/when scope semantics defined upstream.

## Notes

- `_config_version` is internal (currently 23). Do not write it from UI code.
- `agent_ui` is namespaced intentionally to avoid collision with the gateway-functional `agent:` block.
- T1 and T2 agents are static constants in `src/lib/builtin-agents.ts`; they do not have `config.yaml` files.
