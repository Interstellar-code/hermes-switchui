---
title: What are skills
description: Understand what skills are and how they extend your AI agent's capabilities.
---

# What are skills

Skills are self-contained bundles of instructions and logic that extend what your agent can do.

<iframe
  src="/api/docs-asset?path=diagrams/skill-anatomy.html"
  width="100%"
  height="900"
  loading="lazy"
  style="border: 0; border-radius: 8px;"
></iframe>

When the agent recognises a trigger phrase in a conversation it can invoke the matching skill, running its predefined behaviour rather than generating a freeform response.

## How skills work

A skill is a directory on the agent's host machine. The directory contains a manifest file and one or more content files (typically Markdown or plain text). When the agent processes a message it checks the active skill list for matching trigger phrases. If a match is found, the skill's content is injected into the agent's context and the agent follows the skill's instructions.

Skills do not execute arbitrary code by default. They are prompt-based: the skill content tells the agent how to respond to a particular class of request. Some skills may reference external tools or MCP servers if the agent supports tool use.

## Skill origins

The Skills page groups skills by origin:

- **Built-in** — skills shipped with the agent or pre-installed in the default skills directory.
- **Agent-created** — skills the agent generated during a session and saved to disk.
- **Marketplace** — skills installed from the Skills Hub.

The origin label appears in the detail drawer when you select a skill.

## Security levels

Each skill carries a security risk score computed from its content. The detail drawer shows the risk level (safe, low, medium, or high) and a list of flags that contributed to the score. Review the security level before enabling skills from untrusted sources.

## Where skills live on disk

Skills are stored as directories under the agent's skills path. The exact location depends on your agent installation. Common locations:

- `~/.hermes/skills/` — user-level skills
- A `skills/` subdirectory inside the agent installation directory

The workspace-skills view (accessible from the Skills page) also shows skills available to the current workspace, with their full path displayed in the card.

## Related

- [Installing a skill from the hub](./installing-skill.md)
- [Building your own skill](./building-skill.md)
- [Skills page overview](../skills.md)
