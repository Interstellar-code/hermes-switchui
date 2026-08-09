---
title: Working directory
description: Where the agent's shell commands and file edits actually run — and why it is usually not where you think.
---

# Working directory

> `terminal.cwd` decides where every shell command, file write, and `execute_code` call lands. On a fresh install it is usually not your project — it's your home folder — and nothing else in the app tells you that.

> [SCREENSHOT: Settings → Agent → Execution, Working directory card showing the resolved path and source]

## The short version

The gateway config has a line that looks like this:

```yaml
terminal:
  backend: local
  cwd: .
```

`.` looks like "the current directory." It is not a path at all — it's a **sentinel** meaning "not configured." The gateway (`backend: local`) resolves it to your **home directory**, not to wherever you happen to be running commands from, not to any project you've opened in the UI. The identical config line means something different in the `hermes` CLI, where the same `.` resolves to `os.getcwd()` — the shell's actual current directory when you typed `hermes`. Same file, same key, two different answers, because two different programs are reading it.

Switch UI talks to the gateway only, never the CLI. So for everything you do in this app, the rule that matters is: **`terminal.cwd` unset or `.` + `backend: local` → the agent runs in `$HOME`.**

## Where you see it

The chat composer shows a working-directory chip with the resolved path and where it came from. **Settings → Agent → Execution** shows the same information read-only, plus warnings when something about the configuration is likely to surprise you. Both read from one resolver (`/api/agent-cwd`) so they never disagree.

The onboarding wizard's **Workspace** step (step 3 of 4) is the one place that lets you change it, with a preview: type a path, see the before/after, then confirm the write.

## How it resolves

For the `local` backend — the default, and what almost every install uses — the ladder is:

1. **`terminal.cwd` is an absolute path** → used verbatim (after `~` expansion). This is the only way to get the agent working somewhere specific.
2. **`terminal.cwd` is a relative path that isn't `.`, `auto`, or `cwd`** (e.g. `./project`) → bridged into the gateway process as a literal relative path and resolved against *the gateway process's own* working directory — a value Switch UI cannot see or predict. Treat any relative `terminal.cwd` as broken until proven otherwise.
3. **`terminal.cwd` is unset, empty, `.`, `auto`, or `cwd`** → the gateway falls back to your home directory (or `$MESSAGING_CWD`, a deprecated escape hatch, if that env var happens to be set).

There is no per-session or per-message override. The gateway's chat API has no `cwd` field at all — session creation and message sending don't accept a directory, so this one config value governs *every* chat in the profile, for as long as the gateway process stays up.

`code_execution.mode` (default `project`) rides the same ladder: `execute_code` runs wherever the terminal tools resolved the cwd to, so a home-directory fallback means Python scripts write their output into your home folder too. `strict` mode is the exception — it always runs in an isolated temp directory, trading project-relative paths for reproducibility.

## Setting it

Use the onboarding Workspace step, or **Settings → Agent → Execution**'s working-directory control (which is the same resolver — the Execution section shows it read-only and points you at the composer chip / wizard to change it). Either surface:

1. Validates the path is absolute and already exists — a relative path or the sentinel values themselves are refused outright, because writing either would recreate exactly the ambiguity this page is about.
2. Shows a **before → after** preview of what the resolver will report once the value is written, so you see the effect before committing.
3. Writes `terminal.cwd: <absolute path>` into the *active profile's* `config.yaml`.
4. Tells you a **gateway restart is required** — the gateway reads `config.yaml` only when its process starts, so the new value has no effect until you restart it.

Picking "no" or skipping the step is a legitimate answer — the home-directory fallback is a real, working configuration for people who don't want project isolation. What's not fine is not being told, which is what used to happen.

## Docker and other backends

Everything above is the `local`-backend story. If `terminal.backend` is `docker`, `singularity`, `modal`, or `daytona`:

- A sentinel `terminal.cwd` sets nothing at all (unlike `local`, which falls back to `$HOME`) — the container's own default applies instead, which is **`/root`**, inside the sandbox filesystem, not your host.
- With `docker_mount_cwd_to_workspace: true` (off by default), a host path gets bind-mounted and the agent's in-container cwd becomes **`/workspace`** — but the value it mounts is the *host* directory the gateway process happened to have, which is exactly the value Switch UI cannot see.
- A host-looking or relative path handed to a container backend (e.g. `/home/you/project`, `/Users/you/project`) is silently discarded and replaced with `/root` — the container has no way to reach a host path that wasn't explicitly mounted.

`ssh` behaves similarly: a sentinel resolves to `~` on the remote host, not on this machine.

Switch UI's Execution settings only expose `local` and `docker` as pickable backends, because those are the only two this app can validate and describe correctly. Every other backend is raw-YAML-editor territory.

## Profiles don't inherit this

Each profile is a completely separate `config.yaml`. There is no merge with the root config — a profile that has no `terminal:` block at all is not "inheriting" anything; it's simply unset, which for a `local` backend means `$HOME`. Switch UI now closes half of this gap at profile-creation time: when a **new builtin profile is seeded** for the first time, it copies whatever `terminal:` block exists in the root config verbatim into the new profile's `config.yaml`, so a fresh profile starts out behaving like the root did. This is a one-time snapshot, not real inheritance — it happens only once, only for a profile being seeded for the first time, and a later edit to the root's `terminal:` block does not propagate to profiles already created. Switching *between* existing profiles that predate this snapshot, or that were created before you set an absolute path at the root, still drops the setting silently.

## Multiplexing ignores per-profile settings entirely

If `gateway.multiplex_profiles` is on, one gateway process serves several profiles by URL prefix. `TERMINAL_CWD` is a process-wide environment value the gateway sets once, at startup, from whichever profile launched it — profile scoping under multiplexing is otherwise a per-request detail, but this one setting is not scoped per request. **Every profile except the one that launched the gateway has its `terminal.cwd` (and `terminal.backend`) ignored outright.** Editing a non-launch profile's working directory in Switch UI is refused for exactly this reason — the app checks first and tells you which profile actually governs, rather than writing a value the running process will never read.

## The Files browser is a different thing

`/api/workspace` — the folder picker on the Files screen, and the workspace preference stored in `webui_state/workspaces.json` — only moves the **Files-browser jail root**. It has never written `terminal.cwd` and has no effect on where the agent runs. Setting a Files workspace and never touching the Workspace wizard step or the Execution section leaves the agent running in `$HOME` regardless of what the Files browser shows you. The two are unrelated mechanisms that happen to share the word "workspace."

The Switch UI terminal panel (a separate PTY spawned by the Switch UI Node server, not the gateway) is a third, still-unrelated cwd — it defaults to `~/.hermes` and never consults gateway config at all. Running `pwd` there tells you nothing about where the agent's own commands execute.

## Common issues

**The agent can't find files in my project.** Check **Settings → Agent → Execution** → Working directory. If the source shows "$HOME fallback," the agent has never been pointed at your project — use the composer chip or the onboarding Workspace step to set an absolute path, then restart the gateway.

**I set a workspace folder in Files, but the agent still can't see my project.** The Files workspace and the agent's working directory are different settings — see above. Set `terminal.cwd` explicitly.

**I switched profiles and the agent's working directory changed.** Expected, if the profile you switched to has no `terminal:` block of its own (true for most manually-created profiles) — it falls back to `$HOME`. Set it again for that profile.

**I set `terminal.cwd` on a profile and it still runs in `$HOME`.** Two likely causes: you forgot to restart the gateway (it only reads config at process start), or this gateway is multiplexing and the profile you edited isn't the one that launched it.

## Related

- [Profiles](./profiles.md) — profile config, activation, and the restart it requires
- [Execution settings](./execution.md) — the terminal backend and code-execution mode
- [Gateway settings](./gateway.md) — multiplexing and what it changes
- [Files](../main/files.md) — the Files-browser jail root, a separate setting
