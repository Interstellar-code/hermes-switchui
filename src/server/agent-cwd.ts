/**
 * Agent working-directory resolver — "where will the agent actually run, and why".
 *
 * ## Why this module exists
 *
 * Switch UI used to imply that its workspace selector controlled the agent's
 * working directory. It never did. `/api/workspace` only sets the Files-browser
 * jail root; nothing in this repo has ever written `terminal.cwd`, and the
 * gateway's HTTP API has no cwd concept at all (`gateway/platforms/api_server.py`
 * contains zero `cwd` / `workspace` / `working_dir` references — neither
 * session-create nor chat/stream accepts a directory). The only per-session
 * mechanism, `register_task_env_overrides` (`tools/terminal_tool.py:1125`), is
 * reachable only from `tui_gateway/server.py`, `acp_adapter/session.py` and
 * `batch_runner.py` — none of which Switch UI talks to.
 *
 * So the agent's cwd is decided entirely by config the gateway read at *launch*.
 * This module replays that ladder rather than inventing one, so the UI can state
 * the real answer and the provenance behind it.
 *
 * ## The ladder, as verified in the gateway source
 *
 * `terminal.cwd: .` is a SENTINEL, not a relative path. Three modules say so:
 *   - `gateway/cwd_placeholder.py:12`  `CWD_PLACEHOLDERS = {".", "auto", "cwd"}`
 *   - `cli.py:648`                     `_CWD_PLACEHOLDERS = (".", "auto", "cwd")`
 *   - `tools/file_tools.py:166`        `_TERMINAL_CWD_SENTINELS = {"", ".", "./", "auto", "cwd"}`
 *
 * Stage A — `gateway/run.py:1891-1908` decides what `TERMINAL_CWD` holds:
 *   - explicit non-placeholder path  → bridged verbatim (config bridge at
 *     `gateway/run.py:1685-1695` skips placeholders, then this block resolves them)
 *   - placeholder/unset + `local`    → `MESSAGING_CWD` or `Path.home()`
 *   - placeholder + `docker` + mount → `MESSAGING_CWD` (host path, for the
 *     `/workspace` remap) or unset
 *   - placeholder + any other backend → **unset**
 *
 * Stage B — `tools/terminal_tool.py:1387-1417` picks a default when unset:
 *   - `local` → the gateway process cwd, `ssh` → `~`, everything else → `/root`
 *   - `docker` + `docker_mount_cwd_to_workspace` → the host path is tracked as
 *     `host_cwd` and the in-container cwd becomes `/workspace` (line 1410)
 *   - container backends reject host/relative paths and fall back to `/root`
 *     (`_is_unusable_container_cwd`, line 1287)
 *
 * The local branch of Stage A short-circuits before any `os.getcwd()`, so how the
 * daemon was launched is irrelevant in a gateway process: sentinel + local always
 * means `$HOME`.
 *
 * ## CLI/TUI divergence
 *
 * The exact same config line resolves differently in `hermes` CLI/TUI:
 * `cli.py:651-652` **unconditionally** overwrites `terminal.cwd` with
 * `os.getcwd()` whenever the backend is `local` — an explicit configured path is
 * discarded there. Non-local placeholders are popped so the backend default
 * applies. We model the host explicitly instead of pretending there is one answer.
 *
 * ## Two gaps this resolver has to report rather than paper over
 *
 * 1. **Profile configs do not inherit.** `hermes_cli/config.py` reads only
 *    `HERMES_HOME/config.yaml`; no seeded profile ships a `terminal:` block, so
 *    switching profile silently drops the setting and the agent falls back to
 *    `$HOME`.
 * 2. **Multiplex ignores per-profile terminal settings.** Under
 *    `gateway.multiplex_profiles`, `TERMINAL_CWD` is a process-wide `os.environ`
 *    value set once at import time from the launch profile, while profile scoping
 *    is a per-request contextvar. Every non-launch profile therefore runs where
 *    the launch profile says. Reporting a non-launch profile's own `terminal.cwd`
 *    as effective would be a lie, so we resolve against the launch profile and say
 *    so.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  getActiveProfileName,
  readProfile,
  updateProfileConfig,
} from './profiles-browser'
import { CLAUDE_DASHBOARD_URL } from './gateway-capabilities'

// ── Gateway constants, mirrored ────────────────────────────────────────────
// These are pinned to the Python source by agent-cwd.contract.test.ts. If an
// upstream change moves them, that test fails instead of this module quietly
// lying to users.

/** `gateway/cwd_placeholder.py:12` — sentinel values meaning "not configured". */
export const GATEWAY_CWD_PLACEHOLDERS: ReadonlySet<string> = new Set([
  '.',
  'auto',
  'cwd',
])

/**
 * `tools/file_tools.py:166` — the file/terminal-tool layer treats a strictly
 * LARGER set as sentinels. `""` and `"./"` are in this set but NOT in the
 * gateway's, which is a real divergence: `terminal.cwd: ./` survives the gateway
 * bridge as a literal relative path.
 */
export const FILE_TOOLS_CWD_SENTINELS: ReadonlySet<string> = new Set([
  '',
  '.',
  './',
  'auto',
  'cwd',
])

/** `tools/terminal_tool.py:1268`. */
export const CONTAINER_BACKENDS: ReadonlySet<string> = new Set([
  'docker',
  'singularity',
  'modal',
  'daytona',
])

/** `tools/terminal_tool.py:1266` — prefixes that mark a path as host-side. */
export const HOST_CWD_PREFIXES: ReadonlyArray<string> = [
  '/Users/',
  '/home/',
  'C:\\',
  'C:/',
]

/** `tools/terminal_tool.py:1392` — default cwd for container backends. */
export const CONTAINER_DEFAULT_CWD = '/root'
/** `tools/terminal_tool.py:1390` — default cwd for the ssh backend. */
export const SSH_DEFAULT_CWD = '~'
/** `tools/terminal_tool.py:1410` — in-container cwd when the host cwd is mounted. */
export const DOCKER_MOUNT_WORKSPACE_CWD = '/workspace'
/** `tools/terminal_tool.py:1440-1444` reads `TERMINAL_ENV`, defaulting to local. */
export const DEFAULT_TERMINAL_BACKEND = 'local'
/** `tools/code_execution_tool.py:1700-1701`. */
export const EXECUTION_MODES: ReadonlyArray<string> = ['project', 'strict']
export const DEFAULT_EXECUTION_MODE = 'project'

// ── Types ──────────────────────────────────────────────────────────────────

export type AgentCwdSource =
  /** An explicit path reached the agent — from `terminal.cwd`, or the deprecated
   *  `MESSAGING_CWD` fallback (which is named in the warnings when it applies). */
  | 'explicit-config'
  /** `terminal.cwd` was a sentinel (or absent) and the backend is `local`, so the
   *  gateway resolved it to `Path.home()`. */
  | 'home-sentinel'
  /** No `TERMINAL_CWD` reached the sandbox, so `terminal_tool`'s per-backend
   *  default applied (`/root`, `~` for ssh, `/workspace` for a mounted docker cwd). */
  | 'container-default'
  /** Not determinable from config alone — a CLI-local process cwd, or a relative
   *  path anchored to the gateway process cwd. */
  | 'unknown'

export type ResolvedCwd = {
  /** `null` when it genuinely cannot be determined. Never a guess. */
  path: string | null
  source: AgentCwdSource
  /** `terminal.backend` as the gateway sees it. */
  backend: string
  /** Whose config this answer came from — under multiplex, the LAUNCH profile. */
  profile: string
  warnings: Array<string>
}

/** Which process is doing the resolving. The same config line differs between them. */
export type AgentCwdHost = 'gateway' | 'cli'

/** The `terminal:` slice of one profile's `config.yaml`, normalised. */
export type ProfileTerminalConfig = {
  /** Whether a `terminal:` mapping exists at all. `false` drives the inheritance warning. */
  present: boolean
  /** Raw `terminal.cwd`, `''` when absent. */
  cwd: string
  /** Raw `terminal.backend`, `''` when absent (the gateway then defaults to local). */
  backend: string
  dockerMountCwdToWorkspace: boolean
  /** `terminal.persistent_shell`, `null` when absent. */
  persistentShell: boolean | null
}

export type ResolveAgentCwdInput = {
  /** The profile the UI is asking about. */
  profile: string
  /** That profile's terminal config. */
  config: ProfileTerminalConfig
  /** `Path.home()` equivalent — the gateway's `home_fallback`. */
  homeDir: string
  /** Defaults to `'gateway'`; Switch UI always talks to a gateway. */
  host?: AgentCwdHost
  /** Whether the LIVE gateway process is multiplexing profiles. */
  multiplex?: boolean
  /** The profile whose `config.yaml` the running process read at import time. */
  launchProfile?: string | null
  /** That profile's terminal config, needed for the multiplex answer. */
  launchConfig?: ProfileTerminalConfig | null
  /** Deprecated back-compat env fallback (`gateway/run.py:1898`). */
  messagingCwd?: string | null
  /** Only knowable for `host: 'cli'`, and only by the caller. */
  cliProcessCwd?: string | null
  /** `code_execution.mode` from the same config, for the execute_code warning. */
  codeExecutionMode?: string | null
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/** True for the gateway's sentinel set (empty included, per `run.py:1894`). */
export function isCwdPlaceholder(value: string | null | undefined): boolean {
  const trimmed = (value ?? '').trim()
  return trimmed === '' || GATEWAY_CWD_PLACEHOLDERS.has(trimmed)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    return ['true', '1', 'yes'].includes(value.trim().toLowerCase())
  }
  return false
}

/** `tools/terminal_tool.py:1271-1284` — ssh tilde paths are expanded remotely. */
function isSshRemoteTilde(backend: string, cwd: string): boolean {
  return backend === 'ssh' && (cwd === '~' || cwd.startsWith('~/'))
}

function expandTilde(value: string, homeDir: string): string {
  if (value === '~') return homeDir
  if (value.startsWith('~/')) return path.posix.join(homeDir, value.slice(2))
  return value
}

/** `tools/terminal_tool.py:1287-1305`. */
export function isUnusableContainerCwd(cwd: string): boolean {
  if (!cwd) return false
  if (HOST_CWD_PREFIXES.some((prefix) => cwd.startsWith(prefix))) return true
  return !cwd.startsWith('/')
}

/** Pull the `terminal:` slice out of a parsed `config.yaml`. */
export function readTerminalConfig(
  config: Record<string, unknown> | null | undefined,
): ProfileTerminalConfig {
  const raw = config?.terminal
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      present: false,
      cwd: '',
      backend: '',
      dockerMountCwdToWorkspace: false,
      persistentShell: null,
    }
  }
  const terminal = raw as Record<string, unknown>
  // `cli.py:640-642` accepts the legacy `env_type` key with `backend` winning.
  const backend =
    readString(terminal.backend) || readString(terminal.env_type) || ''
  return {
    present: true,
    cwd: readString(terminal.cwd),
    backend: backend.toLowerCase(),
    dockerMountCwdToWorkspace: readBool(terminal.docker_mount_cwd_to_workspace),
    persistentShell:
      terminal.persistent_shell === undefined
        ? null
        : readBool(terminal.persistent_shell),
  }
}

export const EMPTY_TERMINAL_CONFIG: ProfileTerminalConfig = {
  present: false,
  cwd: '',
  backend: '',
  dockerMountCwdToWorkspace: false,
  persistentShell: null,
}

// ── The resolver ───────────────────────────────────────────────────────────

type CwdOutcome = { path: string | null; source: AgentCwdSource }

/**
 * Replay `gateway/run.py` Stage A + `tools/terminal_tool.py` Stage B for a
 * gateway process.
 */
function resolveInGateway(
  config: ProfileTerminalConfig,
  backend: string,
  homeDir: string,
  messagingCwd: string | null,
  warnings: Array<string>,
): CwdOutcome {
  const rawCwd = config.cwd.trim()
  const isExplicit = rawCwd !== '' && !GATEWAY_CWD_PLACEHOLDERS.has(rawCwd)

  // ── Stage A: what gateway/run.py leaves in TERMINAL_CWD ──────────────────
  let terminalCwd: string | null = null
  let fromMessagingCwd = false

  if (isExplicit) {
    terminalCwd = isSshRemoteTilde(backend, rawCwd)
      ? rawCwd
      : expandTilde(rawCwd, homeDir)
  } else if (backend === 'local') {
    const messaging = (messagingCwd ?? '').trim()
    if (messaging) {
      terminalCwd = expandTilde(messaging, homeDir)
      fromMessagingCwd = true
    } else {
      terminalCwd = homeDir
    }
  } else if (backend === 'docker' && config.dockerMountCwdToWorkspace) {
    const messaging = (messagingCwd ?? '').trim()
    if (messaging && !GATEWAY_CWD_PLACEHOLDERS.has(messaging)) {
      terminalCwd = expandTilde(messaging, homeDir)
      fromMessagingCwd = true
    }
  }

  if (fromMessagingCwd) {
    warnings.push(
      'This path comes from the deprecated MESSAGING_CWD environment variable, ' +
        'not from config.yaml (gateway/run.py:1898). `hermes doctor` flags it — ' +
        'move it to terminal.cwd so a profile switch cannot silently change it.',
    )
  }

  // ── Stage B/C: tools/terminal_tool.py:1387-1417 ──────────────────────────
  if (backend === 'docker' && config.dockerMountCwdToWorkspace) {
    warnings.push(
      terminalCwd
        ? `terminal.docker_mount_cwd_to_workspace bind-mounts the host path "${terminalCwd}" ` +
            `to ${DOCKER_MOUNT_WORKSPACE_CWD}; the agent's cwd INSIDE the container is ${DOCKER_MOUNT_WORKSPACE_CWD}.`
        : 'terminal.docker_mount_cwd_to_workspace is on but no host path is configured, so ' +
            'terminal_tool falls back to the gateway process cwd as the mount source ' +
            '(tools/terminal_tool.py:1403) — a value Switch UI cannot see.',
    )
    return { path: DOCKER_MOUNT_WORKSPACE_CWD, source: 'container-default' }
  }

  if (backend === 'local') {
    // Stage A always fills TERMINAL_CWD for local, so `terminalCwd` is non-null.
    const value = terminalCwd ?? homeDir
    if (!path.posix.isAbsolute(value) && !/^[A-Za-z]:[\\/]/.test(value)) {
      warnings.push(
        `terminal.cwd is "${config.cwd}", a RELATIVE path. The gateway's sentinel set is ` +
          'only {".", "auto", "cwd"} (gateway/cwd_placeholder.py:12), so this is bridged ' +
          'verbatim and resolved against the gateway process cwd — a value Switch UI cannot ' +
          'see. (tools/file_tools.py:166 does treat "./" as a sentinel, so file writes and ' +
          'shell commands can disagree.) Set an absolute path.',
      )
      return { path: null, source: 'unknown' }
    }
    if (isExplicit) return { path: value, source: 'explicit-config' }
    if (fromMessagingCwd) return { path: value, source: 'explicit-config' }
    warnings.push(
      `terminal.cwd is ${config.cwd ? `the sentinel "${config.cwd}"` : 'unset'} and the backend is ` +
        'local, so the gateway resolves it to Path.home() (gateway/cwd_placeholder.py:40-42). ' +
        'The agent runs in your home directory, not in any project.',
    )
    return { path: homeDir, source: 'home-sentinel' }
  }

  const defaultCwd = backend === 'ssh' ? SSH_DEFAULT_CWD : CONTAINER_DEFAULT_CWD

  if (terminalCwd === null) {
    warnings.push(
      `Backend "${backend}" is not local, so a sentinel terminal.cwd sets no TERMINAL_CWD at all ` +
        `(gateway/cwd_placeholder.py:47). terminal_tool falls back to its per-backend default ` +
        `"${defaultCwd}" (tools/terminal_tool.py:1387-1392) — inside the sandbox, not on your host.`,
    )
    return { path: defaultCwd, source: 'container-default' }
  }

  if (
    CONTAINER_BACKENDS.has(backend) &&
    isUnusableContainerCwd(terminalCwd) &&
    terminalCwd !== defaultCwd
  ) {
    warnings.push(
      `terminal.cwd "${terminalCwd}" is a host or relative path, which cannot be a container ` +
        `workdir. terminal_tool discards it and uses "${defaultCwd}" instead ` +
        '(tools/terminal_tool.py:1411-1417).',
    )
    return { path: defaultCwd, source: 'container-default' }
  }

  return { path: terminalCwd, source: 'explicit-config' }
}

/**
 * Answer "where will the agent actually run, and why" for one profile.
 *
 * Pure — every environment read is an explicit input, so the table-driven tests
 * exercise the real ladder rather than a mock of it.
 */
export function resolveAgentCwd(input: ResolveAgentCwdInput): ResolvedCwd {
  const host: AgentCwdHost = input.host ?? 'gateway'
  const warnings: Array<string> = []

  // ── Whose config actually governs? ───────────────────────────────────────
  let config = input.config
  let profile = input.profile

  if (input.multiplex) {
    const launch = (input.launchProfile ?? '').trim()
    if (!launch) {
      warnings.push(
        'This gateway is multiplexing profiles but its launch profile could not be ' +
          'determined, so the effective working directory cannot be attributed to any ' +
          'profile. Check that the Hermes dashboard is reachable.',
      )
      return {
        path: null,
        source: 'unknown',
        backend: input.config.backend || DEFAULT_TERMINAL_BACKEND,
        profile: input.profile,
        warnings,
      }
    }
    if (launch !== input.profile) {
      warnings.push(
        `This gateway multiplexes profiles. TERMINAL_CWD is a process-wide environment value ` +
          `set once at startup from the LAUNCH profile "${launch}", while profile scoping is a ` +
          `per-request contextvar — so "${input.profile}"'s own terminal settings are ignored ` +
          `entirely. The agent runs where "${launch}" says, and editing "${input.profile}" will ` +
          'not change that.',
      )
      config = input.launchConfig ?? EMPTY_TERMINAL_CONFIG
      profile = launch
    }
  }

  const backend = config.backend || DEFAULT_TERMINAL_BACKEND

  // ── The inheritance gap ──────────────────────────────────────────────────
  if (!config.present) {
    warnings.push(
      `Profile "${profile}" has no \`terminal:\` block. Profile configs do NOT inherit from the ` +
        'default profile — hermes_cli/config.py reads only HERMES_HOME/config.yaml — so ' +
        'terminal.cwd is unset here even if another profile sets it, and switching to this ' +
        'profile silently drops the setting.',
    )
  }

  // ── Resolve ──────────────────────────────────────────────────────────────
  let resolved: CwdOutcome
  if (host === 'cli' && backend === 'local') {
    warnings.push(
      'In the hermes CLI/TUI with a local backend, cli.py:651-652 UNCONDITIONALLY overwrites ' +
        'terminal.cwd with os.getcwd(). A configured path is discarded there; only ' +
        '`cd /your/dir && hermes` controls it. This is the opposite of the gateway, where the ' +
        'same config line resolves to Path.home().',
    )
    resolved = {
      path: (input.cliProcessCwd ?? '').trim() || null,
      source: 'unknown',
    }
  } else {
    // CLI non-local pops placeholders instead of consulting MESSAGING_CWD
    // (cli.py:655-656), so the only difference is that fallback.
    resolved = resolveInGateway(
      config,
      backend,
      input.homeDir,
      host === 'cli' ? null : (input.messagingCwd ?? null),
      warnings,
    )
  }

  // ── Adjacent settings that silently follow the same ladder ───────────────
  const executionMode = (input.codeExecutionMode ?? '').trim() || DEFAULT_EXECUTION_MODE
  if (executionMode === 'project' && resolved.source === 'home-sentinel') {
    warnings.push(
      'code_execution.mode is "project" (the default), which follows this same ladder ' +
        '(tools/code_execution_tool.py:1795-1810) — so execute_code also runs in your home ' +
        'directory.',
    )
  }
  if (backend === 'local' && config.persistentShell === true) {
    warnings.push(
      'terminal.persistent_shell: true is a no-op on the local backend. It bridges to ' +
        'TERMINAL_PERSISTENT_SHELL, which is only read as the SSH default; local reads ' +
        'TERMINAL_LOCAL_PERSISTENT, which no config key sets ' +
        '(tools/terminal_tool.py:1438-1444).',
    )
  }

  return {
    path: resolved.path,
    source: resolved.source,
    backend,
    profile,
    warnings,
  }
}

// ── Live status (I/O) ──────────────────────────────────────────────────────

export type GatewayLaunchInfo = {
  /** Whether the LIVE process multiplexes — probed, never read from config. */
  multiplex: boolean
  /** The profile whose config.yaml the running process read at import time. */
  launchProfile: string | null
  reachable: boolean
}

const LAUNCH_PROBE_TTL_MS = 10_000
const LAUNCH_PROBE_TIMEOUT_MS = 1_500
let launchProbeCache: { at: number; value: GatewayLaunchInfo } | null = null

/** Reset the launch-info cache. Tests and connection-setting changes use this. */
export function invalidateGatewayLaunchInfo(): void {
  launchProbeCache = null
}

/**
 * Probe the live gateway for its topology and launch profile.
 *
 * Deliberately a probe and not a config read: `gateway.multiplex_profiles: true`
 * in config.yaml does not prove the RUNNING process was started with it, and
 * `~/.hermes/active_profile` is what the profile is NOW, not what it was when
 * the daemon booted. Fails closed to "single, unknown launch profile".
 */
export async function getGatewayLaunchInfo(
  opts: { force?: boolean } = {},
): Promise<GatewayLaunchInfo> {
  if (
    !opts.force &&
    launchProbeCache &&
    Date.now() - launchProbeCache.at < LAUNCH_PROBE_TTL_MS
  ) {
    return launchProbeCache.value
  }
  let value: GatewayLaunchInfo = {
    multiplex: false,
    launchProfile: null,
    reachable: false,
  }
  try {
    const res = await fetch(`${CLAUDE_DASHBOARD_URL}/api/status`, {
      signal: AbortSignal.timeout(LAUNCH_PROBE_TIMEOUT_MS),
    })
    if (res.ok) {
      const body = (await res.json()) as {
        gateway_mode?: string
        hermes_home?: string
        gateways?: Array<{ profile?: string; served_profiles?: Array<string> }>
      }
      const entries = body.gateways ?? []
      const multiplex =
        body.gateway_mode === 'multiplex' ||
        body.gateway_mode === 'multiple' ||
        entries.some((g) => (g.served_profiles?.length ?? 0) > 1)
      // HERMES_HOME is what the process actually booted against, which is
      // exactly the "launch profile" the multiplex caveat is about.
      const home = body.hermes_home ?? ''
      const launchProfile = home
        ? home.includes('/profiles/')
          ? (home.split('/profiles/').pop()?.split('/')[0] ?? null) || null
          : 'default'
        : (entries.find((g) => g.profile)?.profile ?? null)
      value = {
        multiplex,
        launchProfile: launchProfile ? String(launchProfile) : null,
        reachable: true,
      }
    }
  } catch {
    // fail closed
  }
  launchProbeCache = { at: Date.now(), value }
  return value
}

function readProfileConfigSafe(
  name: string,
): Record<string, unknown> | null {
  try {
    return readProfile(name).config
  } catch {
    return null
  }
}

export type AgentCwdStatus = {
  resolved: ResolvedCwd
  /** The profile the user is looking at — may differ from `resolved.profile`. */
  activeProfile: string
  launch: GatewayLaunchInfo
  /** Raw `terminal.cwd` as written in the governing profile's config.yaml. */
  configuredCwd: string
  /** Whether the governing profile has a `terminal:` block at all. */
  hasTerminalBlock: boolean
  /** Whether editing `terminal.cwd` on `activeProfile` would actually take effect. */
  editable: boolean
  /** A sane absolute path to offer as the one-click fix, or `null`. */
  suggestedCwd: string | null
  homeDir: string
}

/**
 * Read the live answer for the active profile.
 *
 * `suggestedWorkspace` lets the caller feed in the Files-browser root as the
 * preferred one-click fix — the two are unrelated mechanisms, but if the user
 * already picked a project directory there it is the best guess available.
 */
export async function getAgentCwdStatus(opts?: {
  profile?: string
  suggestedWorkspace?: string | null
}): Promise<AgentCwdStatus> {
  const activeProfile = (opts?.profile ?? '').trim() || getActiveProfileName()
  const homeDir = os.homedir()
  const launch = await getGatewayLaunchInfo()

  const activeRaw = readProfileConfigSafe(activeProfile)
  const config = readTerminalConfig(activeRaw)
  const launchRaw =
    launch.launchProfile && launch.launchProfile !== activeProfile
      ? readProfileConfigSafe(launch.launchProfile)
      : activeRaw
  const launchConfig = readTerminalConfig(launchRaw)

  const governingRaw =
    launch.multiplex && launch.launchProfile && launch.launchProfile !== activeProfile
      ? launchRaw
      : activeRaw
  const codeExecution = governingRaw?.code_execution
  const codeExecutionMode =
    codeExecution && typeof codeExecution === 'object' && !Array.isArray(codeExecution)
      ? readString((codeExecution as Record<string, unknown>).mode)
      : ''

  const resolved = resolveAgentCwd({
    profile: activeProfile,
    config,
    launchConfig,
    launchProfile: launch.launchProfile,
    multiplex: launch.multiplex,
    homeDir,
    messagingCwd: process.env.MESSAGING_CWD ?? null,
    codeExecutionMode,
  })

  const governing = readTerminalConfig(governingRaw)
  const editable = resolved.profile === activeProfile

  const suggestion = (opts?.suggestedWorkspace ?? '').trim()
  const suggestedCwd =
    suggestion && path.isAbsolute(suggestion) && isExistingDirectory(suggestion)
      ? suggestion
      : homeDir

  return {
    resolved,
    activeProfile,
    launch,
    configuredCwd: governing.cwd,
    hasTerminalBlock: governing.present,
    editable,
    suggestedCwd,
    homeDir,
  }
}

function isExistingDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

export class AgentCwdValidationError extends Error {
  readonly code = 'AGENT_CWD_INVALID'
}

/**
 * Validate a candidate agent cwd. Absolute (after `~` expansion), existing, and
 * a directory — the three things that make `docker run -w` / `subprocess.Popen`
 * fail loudly if we get them wrong.
 */
export function validateAgentCwd(input: string, homeDir = os.homedir()): string {
  const raw = input.trim()
  if (!raw) throw new AgentCwdValidationError('A directory is required.')
  if (GATEWAY_CWD_PLACEHOLDERS.has(raw) || FILE_TOOLS_CWD_SENTINELS.has(raw)) {
    throw new AgentCwdValidationError(
      `"${raw}" is a sentinel value meaning "not configured", not a directory. ` +
        'Give an absolute path.',
    )
  }
  const expanded = expandTilde(raw, homeDir)
  if (!path.isAbsolute(expanded)) {
    throw new AgentCwdValidationError(
      `"${raw}" is a relative path. The gateway bridges it verbatim and resolves it against ` +
        'the gateway process cwd, which nothing here can see. Give an absolute path.',
    )
  }
  const normalized = path.resolve(expanded)
  if (!isExistingDirectory(normalized)) {
    throw new AgentCwdValidationError(
      `"${normalized}" is not an existing directory.`,
    )
  }
  return normalized
}

/**
 * Write `terminal.cwd` into a profile's config.yaml.
 *
 * Goes through `updateProfileConfig` so the deep-merge semantics stay identical
 * to every other profile write. The gateway reads config only at import time, so
 * callers MUST raise the gateway-restart prompt afterwards.
 */
export function writeAgentCwd(profile: string, cwd: string): string {
  const normalized = validateAgentCwd(cwd)
  updateProfileConfig(profile, { terminal: { cwd: normalized } })
  return normalized
}

/**
 * Project what the resolver WOULD say after writing `cwd`, without writing.
 *
 * The composer uses this for the before → after confirmation: this is the only
 * Switch UI control that changes where commands actually execute, so the user
 * sees both directories before anything is persisted.
 */
export async function previewAgentCwd(
  profile: string,
  cwd: string,
): Promise<ResolvedCwd> {
  const normalized = validateAgentCwd(cwd)
  const homeDir = os.homedir()
  const launch = await getGatewayLaunchInfo()
  const current = readTerminalConfig(readProfileConfigSafe(profile))
  const next: ProfileTerminalConfig = {
    ...current,
    present: true,
    cwd: normalized,
  }
  const launchConfig =
    launch.launchProfile && launch.launchProfile !== profile
      ? readTerminalConfig(readProfileConfigSafe(launch.launchProfile))
      : next
  return resolveAgentCwd({
    profile,
    config: next,
    launchConfig,
    launchProfile: launch.launchProfile,
    multiplex: launch.multiplex,
    homeDir,
    messagingCwd: process.env.MESSAGING_CWD ?? null,
  })
}

/**
 * Human-readable provenance, used by the composer chip and the terminal footer.
 */
export function describeAgentCwdSource(source: AgentCwdSource): string {
  switch (source) {
    case 'explicit-config':
      return 'from terminal.cwd'
    case 'home-sentinel':
      return '$HOME fallback'
    case 'container-default':
      return 'sandbox default'
    default:
      return 'undetermined'
  }
}
