# Profiles Revamp — Vocabulary Lock

This table is the canonical vocabulary for the Profiles Revamp plan (`profiles-revamp.md`).
All code, comments, and documentation MUST use these terms consistently.

| Term | Meaning |
|---|---|
| **Profile** | Synonym for **Agent** / **Tier-3 Agent**. A directory under `~/.hermes/profiles/<name>/` with `config.yaml`. |
| **Agent** | User-facing name for a Profile. UI says "Agent"; filesystem says "profile". Same thing. |
| **Tier-1 Agent (T1)** | Built-in **Hermes Switch** orchestrator. Static constant, not in `~/.hermes/profiles/`. Not editable. |
| **Tier-2 Agent (T2)** | Built-in archetypes: **Neo**, **Trinity**, **Morpheus**. Static constants. Not editable. |
| **Tier-3 Agent (T3)** | User-created profile via the wizard. Lives under `~/.hermes/profiles/`. Editable, deletable (except `default`). |
| **Persona** | Reusable markdown template under `~/.hermes/personas/<category>/<id>.md` with YAML frontmatter. User-mutable on disk; read-only from UI in this iteration. |
| **Persona snapshot** | The frozen `system_prompt` string copied from a persona MD into a profile's **top-level `system_prompt`** at create time (the key the gateway honors). `agent_ui.persona_id` retains provenance. Persona edits on disk do **not** propagate to existing profiles. |
| **Persona metadata table** | `assets/personas-metadata.json` in repo — maps source persona files to glyph/tags/description. Used only by the seeder. |
| **Default profile** | `~/.hermes/` (root) — gateway's fallback. Cannot be edited or deleted from UI. Rendered as read-only. |
| **Seeder** | One-shot script that reads source MDs from a configurable corpus dir and writes Hermes-formatted persona MDs to `~/.hermes/personas/`. |
