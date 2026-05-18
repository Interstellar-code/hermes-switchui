---
title: Building your own skill
description: Create a custom skill to add new commands or behaviours to your agent.
---

# Building your own skill

A skill is a directory containing a manifest and one or more content files. You can create a skill manually on the agent's host machine and the agent will pick it up the next time it loads its skills directory.

## Directory layout

```
my-skill/
  skill.md          # main skill content (required)
  README.md         # optional human-readable description
```

More complex skills can include additional Markdown files. The agent reads all `.md` files in the directory.

## Manifest fields

Skills are described by metadata embedded in the content file or in a separate YAML front-matter block. The fields the agent reads include:

| Field | Description |
|---|---|
| `name` | Display name shown in the Skills page. |
| `description` | Short summary shown in the skill card. |
| `triggers` | List of phrases that cause the agent to invoke this skill. |
| `tags` | Arbitrary labels used for filtering. |
| `author` | Your name or handle. |
| `category` | Category used in the Skills page filter. |

Example front-matter at the top of `skill.md`:

```markdown
---
name: My Custom Skill
description: Does something useful when asked.
triggers:
  - do the thing
  - run my custom task
tags:
  - productivity
author: you
category: utilities
---

# My Custom Skill

When invoked, follow these instructions...
```

## Where to place the skill

Place the skill directory inside the agent's skills folder:

```
~/.hermes/skills/my-skill/
```

The agent scans this directory at startup. If the agent is already running, you may need to restart it or trigger a skills reload for the new skill to appear in the UI.

## Verifying the install

After placing the skill and restarting the agent:

1. Navigate to **Skills** in the sidebar.
2. Select the **Installed** filter.
3. Find your skill in the grid. Click it to confirm the name, description, and triggers loaded correctly.

## Security considerations

The Skills page displays a security risk score for each skill based on its content. Skills that reference shell commands, file paths, or network calls will score higher. Write skill content with the least privilege needed for the task.

## Related

- [What are skills](./what-are-skills.md)
- [Installing a skill from the hub](./installing-skill.md)
- [Skills page overview](../skills.md)
