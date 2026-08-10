/**
 * Read-only setup diagnostics.
 *
 * Why this exists
 * ---------------
 * A user's install broke and the UI told them nothing useful. The gateway
 * process was running, `hermes gateway run` had been executed, and the
 * workspace still showed a generic "Welcome! Let's connect your backend"
 * screen with an **Auto-Start Hermes Agent Gateway** button — an action that
 * could not possibly help, because a gateway was already running. It simply
 * was not listening on :8642.
 *
 * The cause was a profile-scoping footgun (fixed elsewhere): the active
 * profile had been switched to a bare seeded profile whose `.env` is empty,
 * and profile scoping reads only `<profile>/.env` with **no root fallback**.
 * So the root `.env`'s `API_SERVER_ENABLED` / `API_SERVER_KEY` became
 * invisible, the `api_server` platform never enabled, and the running gateway
 * bound nothing.
 *
 * This module does not fix that. It makes that CLASS of failure legible:
 * every check returns a specific, actionable finding instead of contributing
 * to one useless boolean.
 *
 * Hard rules
 * ----------
 *  - **Read-only.** Nothing here writes, creates, renames or deletes a file.
 *  - **Never throws.** Every check is independently wrapped; a check that
 *    cannot complete degrades to an `unknown` finding rather than taking the
 *    whole report down with it. A diagnostics report that fails when things
 *    are broken is worthless.
 *  - **No secrets in the payload.** Tokens are compared by SHA-256
 *    fingerprint; the values never leave this module.
 *  - **No shelling out.** See `checkGatewayProcess` for exactly what is and
 *    is not knowable about the gateway process without `ps`/`ss`.
 *
 * Every check is a pure function of explicitly-passed inputs (a Hermes root
 * directory, a profile name, an already-probed capability object) so it can
 * be tested against a temp directory with no mocking of `os.homedir()`.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import YAML from 'yaml'

import { getHermesRoot } from './claude-paths'
import {
  CLAUDE_API,
  CLAUDE_DASHBOARD_URL,
  ensureGatewayProbed,
} from './gateway-capabilities'
import { getGatewayMode as getGatewayScopeMode } from './profile-scope'
import type { GatewayCapabilities } from './gateway-capabilities'

// ── Types ─────────────────────────────────────────────────────────

export type DiagnosticSeverity =
  /** Verified working. */
  | 'ok'
  /** Worth saying out loud, but nothing is broken. */
  | 'info'
  /** The check could not be completed. NOT the same as "the answer is no" —
   *  conflating those is how a diagnostic starts lying. */
  | 'unknown'
  /** Something is misconfigured and will bite, but may not be THE cause. */
  | 'warning'
  /** This is broken and is very likely why nothing works. */
  | 'error'

export type DiagnosticFinding = {
  /** Stable id — the UI may key remedies/links off this, never off copy. */
  id: string
  severity: DiagnosticSeverity
  /** One line, plain language, stating what is wrong. No jargon a first-time
   *  user would have to look up; if a term like "profile" is unavoidable it is
   *  explained in `detail`. */
  title: string
  /** Optional supporting facts: paths, counts, pids. Multi-line is fine. */
  detail?: string
  /** A concrete thing the user can do. Omitted only when there is nothing to
   *  do (i.e. the check passed). */
  remedy?: string
  /** Structured, non-secret facts for the UI. Never contains a token value. */
  data?: Record<string, unknown>
}

export type SetupDiagnostics = {
  generatedAt: string
  gatewayUrl: string
  dashboardUrl: string
  /** Worst severity across all findings. */
  severity: DiagnosticSeverity
  /**
   * Is a Hermes gateway process alive right now?
   *  - `true`  → the UI must NOT offer "Auto-Start". Starting a second one is
   *              exactly the useless action this whole module exists to stop.
   *  - `false` → nothing is running; Auto-Start is the right offer.
   *  - `null`  → could not be determined; treat as "maybe" and prefer the
   *              non-destructive action.
   */
  gatewayProcessRunning: boolean | null
  /** Capability names the probe reported as absent, so the UI can name them
   *  concretely instead of saying "backend not connected". */
  missingCapabilities: Array<string>
  /**
   * True when there is no evidence of a Hermes install on this machine at
   * all. A genuinely new user and a broken install are different situations
   * and must look different: the first-run welcome is correct here and a
   * diagnostic dump is not.
   */
  firstRun: boolean
  findings: Array<DiagnosticFinding>
}

// ── Severity helpers ──────────────────────────────────────────────

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = {
  ok: 0,
  info: 1,
  // `unknown` outranks `info` (it hides a possible problem) but never outranks
  // a confirmed `warning` — a thing we know is wrong beats a thing we couldn't
  // check.
  unknown: 2,
  warning: 3,
  error: 4,
}

export function worstSeverity(
  findings: Array<DiagnosticFinding>,
): DiagnosticSeverity {
  let worst: DiagnosticSeverity = 'ok'
  for (const finding of findings) {
    if (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[worst]) {
      worst = finding.severity
    }
  }
  return worst
}

/** Wrap a check so a throw becomes an `unknown` finding, never a 500. */
function safeCheck(
  id: string,
  label: string,
  run: () => DiagnosticFinding,
): DiagnosticFinding {
  try {
    return run()
  } catch (err) {
    return unknownFinding(id, label, err)
  }
}

async function safeCheckAsync(
  id: string,
  label: string,
  run: () => Promise<DiagnosticFinding>,
): Promise<DiagnosticFinding> {
  try {
    return await run()
  } catch (err) {
    return unknownFinding(id, label, err)
  }
}

function unknownFinding(
  id: string,
  label: string,
  err: unknown,
): DiagnosticFinding {
  return {
    id,
    severity: 'unknown',
    title: `${label} could not be checked.`,
    detail: err instanceof Error ? err.message : String(err),
    remedy:
      'This is a gap in the diagnosis, not a verdict — the underlying problem may still be elsewhere in this list.',
  }
}

// ── Small read-only filesystem helpers ────────────────────────────

function readTextOrNull(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

function readJsonOrNull(filePath: string): Record<string, unknown> | null {
  const raw = readTextOrNull(filePath)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Which profile is selected, read the same way the rest of the app reads it
 * (`<hermesRoot>/active_profile`, defaulting to `default`).
 *
 * Deliberately re-implemented here rather than imported from
 * `profiles-browser`: that module resolves the Hermes root from
 * `process.env`/`os.homedir()` internally, which would make every check in
 * this file untestable without mocking the environment. Six lines of
 * duplication buys a pure function of an explicit root.
 */
export function readActiveProfileName(hermesRoot: string): string {
  const raw = readTextOrNull(path.join(hermesRoot, 'active_profile'))
  return raw?.trim() || 'default'
}

/**
 * Absolute path to the Hermes home the given profile resolves to.
 * `default` (and an absent selection) means the root itself — profiles live
 * at `<root>/profiles/<name>` and `default` has no directory of its own.
 */
export function profileHomeFor(hermesRoot: string, profile: string): string {
  if (!profile || profile === 'default') return hermesRoot
  return path.join(hermesRoot, 'profiles', profile)
}

/** Names of `KEY=value` entries in a dotenv file. Comments/blanks ignored. */
export function readEnvKeys(filePath: string): Array<string> | null {
  const raw = readTextOrNull(filePath)
  if (raw === null) return null
  const keys: Array<string> = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, '')
    if (key) keys.push(key)
  }
  return keys
}

/** Value of a single `KEY=value` line in already-read dotenv text, or '' when
 *  absent. Factored out of `readEnvValue` so a caller that needs to
 *  distinguish "file missing" from "file unreadable" (see
 *  `readTextWithStatus`) can read the raw text once and still reuse the same
 *  parsing rules. */
function extractEnvValue(raw: string, name: string): string {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    if (
      trimmed
        .slice(0, eq)
        .trim()
        .replace(/^export\s+/, '') !== name
    )
      continue
    return trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')
  }
  return ''
}

/** Value of a single dotenv key, or '' when absent/unreadable. */
function readEnvValue(filePath: string, name: string): string {
  const raw = readTextOrNull(filePath)
  if (raw === null) return ''
  return extractEnvValue(raw, name)
}

/** Top-level keys of a YAML config, or null when the file is absent. */
export function readTopLevelConfigKeys(filePath: string): Array<string> | null {
  const raw = readTextOrNull(filePath)
  if (raw === null) return null
  try {
    const parsed = YAML.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.keys(parsed)
    }
  } catch {
    // Fall through — a config too broken to parse is itself a finding, and a
    // line scan still tells us roughly what it declares.
  }
  const keys: Array<string> = []
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Za-z_][\w-]*)\s*:/.exec(line)
    if (match) keys.push(match[1])
  }
  return Array.from(new Set(keys))
}

/**
 * Fingerprint a secret so two sides can be compared without either value
 * being transmitted, logged, or returned. Truncated SHA-256; the input is a
 * high-entropy key, so 48 bits of digest is ample to tell "same" from
 * "different" and useless for recovering the value.
 */
export function fingerprint(value: string): string {
  if (!value) return ''
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12)
}

// ── Check: gateway reachability ───────────────────────────────────

/**
 * Nothing listening vs listening-but-refusing vs healthy.
 *
 * Reuses the already-probed capability object rather than re-probing:
 * `gateway-capabilities.ts`'s `probeHealth()` is the one place that correctly
 * separates 401 (the gateway IS up, our bearer token is wrong) from
 * unreachable, and its verdict reaches us as `health` + `authError`. Probing
 * again from here would duplicate a 15s timeout budget and could disagree
 * with the status the rest of the UI is rendering.
 */
export function checkGatewayReachability(
  caps: Pick<
    GatewayCapabilities,
    'health' | 'chatCompletions' | 'authError' | 'probed'
  >,
  gatewayUrl: string,
): DiagnosticFinding {
  const id = 'gateway-reachability'

  if (!caps.probed) {
    return {
      id,
      severity: 'unknown',
      title: 'The gateway has not been probed yet, so its state is unknown.',
      remedy: 'Retry in a moment — the first probe runs at startup.',
      data: { gatewayUrl },
    }
  }

  if (caps.authError) {
    return {
      id,
      severity: 'error',
      title: `Hermes Agent is running at ${gatewayUrl} and rejecting this app's access key.`,
      detail:
        'The gateway answered — so it is up and reachable — but it replied "401 Unauthorized". ' +
        'That is a key mismatch, not an outage: the access key this app sends does not match the ' +
        'one the running gateway expects. Every request will keep failing until the two agree. ' +
        'Note this is the gateway key, not the API key of whichever AI provider you use.',
      remedy:
        "Make the two keys match: HERMES_API_TOKEN in this app's .env must equal API_SERVER_KEY in the .env the gateway booted from. See the access-key check below for which files those are.",
      data: { gatewayUrl, reachable: true, authError: true },
    }
  }

  if (caps.health || caps.chatCompletions) {
    return {
      id,
      severity: 'ok',
      title: `Hermes Agent is responding at ${gatewayUrl}.`,
      data: { gatewayUrl, reachable: true, authError: false },
    }
  }

  return {
    id,
    severity: 'error',
    title: `Nothing is listening at ${gatewayUrl}.`,
    detail:
      'The connection was refused or timed out — no reply of any kind came back, not even an ' +
      'error. Either no gateway is running, or one is running without its HTTP API switched on, ' +
      'or it is listening on a different address than the one this app is pointed at.',
    remedy:
      'The gateway-process check below says which of those three it is. Act on that before starting anything.',
    data: { gatewayUrl, reachable: false, authError: false },
  }
}

// ── Check: gateway process ────────────────────────────────────────

export type GatewayStateFile = {
  path: string
  pid: number | null
  gatewayState: string | null
  /** Platform name → state, e.g. `{ api_server: 'connected' }`. An absent
   *  key is meaningful: the running gateway never brought that platform up. */
  platforms: Record<string, string | undefined>
  updatedAt: string | null
}

/**
 * What is actually knowable about the gateway process without `ps`/`ss`.
 *
 * The gateway writes its own runtime state to `<hermesHome>/gateway_state.json`
 * (with `gateway.pid` / `gateway.lock` carrying the same pid). That file is
 * the honest source: it carries the pid, the process's self-reported
 * `gateway_state`, and — critically — the `platforms` map, whose `api_server`
 * entry is the HTTP listener this UI talks to. A running gateway with
 * `platforms: {}` is precisely the case that made Auto-Start useless.
 *
 * Liveness is confirmed with `process.kill(pid, 0)` — a Node builtin signal
 * probe, not a shell-out. On Linux it is additionally corroborated by reading
 * `/proc/<pid>/cmdline` (a plain file read) to confirm the pid really is a
 * hermes process and not a recycled pid. Where `/proc` is unavailable
 * (macOS/Windows) that corroboration is impossible without shelling out, so
 * the finding reports `pidVerified: false` and the copy stays hedged rather
 * than claiming certainty it does not have.
 *
 * NOT knowable here, and deliberately not guessed at:
 *  - Which ports are actually bound. That needs `ss`/`lsof`/a raw socket
 *    scan. We infer "not bound" from the reachability probe instead.
 *  - A gateway started under a different user or a different HERMES_HOME,
 *    which writes its state file somewhere we never look.
 */
function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function defaultVerifyPidIdentity(pid: number): boolean | null {
  const cmdline = readTextOrNull(`/proc/${pid}/cmdline`)
  if (cmdline === null) return null // no /proc — cannot corroborate
  return /hermes/i.test(cmdline)
}

export function readGatewayStateFile(
  hermesHome: string,
): GatewayStateFile | null {
  const statePath = path.join(hermesHome, 'gateway_state.json')
  const state = readJsonOrNull(statePath)
  const source = state ?? readJsonOrNull(path.join(hermesHome, 'gateway.pid'))
  if (!source) return null

  const rawPlatforms = source.platforms
  const platforms: Record<string, string | undefined> = {}
  if (rawPlatforms && typeof rawPlatforms === 'object') {
    for (const [name, value] of Object.entries(
      rawPlatforms as Record<string, unknown>,
    )) {
      const entryState =
        value && typeof value === 'object'
          ? (value as { state?: unknown }).state
          : value
      platforms[name] = typeof entryState === 'string' ? entryState : 'unknown'
    }
  }

  return {
    path: state ? statePath : path.join(hermesHome, 'gateway.pid'),
    pid: typeof source.pid === 'number' ? source.pid : null,
    gatewayState:
      typeof source.gateway_state === 'string' ? source.gateway_state : null,
    platforms,
    updatedAt: typeof source.updated_at === 'string' ? source.updated_at : null,
  }
}

export type GatewayProcessResult = {
  finding: DiagnosticFinding
  running: boolean | null
  /** Hermes home of the live process, when one was found — the directory
   *  whose `.env` that process actually read. */
  liveHome: string | null
}

export function checkGatewayProcess(input: {
  hermesRoot: string
  activeProfile: string
  gatewayUrl: string
  /** From the reachability check — did the gateway answer at all? */
  gatewayReachable: boolean
  isProcessAlive?: (pid: number) => boolean
  verifyPidIdentity?: (pid: number) => boolean | null
}): GatewayProcessResult {
  const id = 'gateway-process'
  const isAlive = input.isProcessAlive ?? defaultIsProcessAlive
  const verify = input.verifyPidIdentity ?? defaultVerifyPidIdentity

  try {
    const activeHome = profileHomeFor(input.hermesRoot, input.activeProfile)
    // Active profile first: that is the process this UI is meant to be
    // talking to. Root second, so a stale root state file never masks it.
    const homes = Array.from(new Set([activeHome, input.hermesRoot]))

    const candidates = homes
      .map((home) => ({ home, state: readGatewayStateFile(home) }))
      .filter(
        (c): c is { home: string; state: GatewayStateFile } => c.state !== null,
      )

    if (candidates.length === 0) {
      return {
        running: false,
        liveHome: null,
        finding: {
          id,
          severity: input.gatewayReachable ? 'info' : 'warning',
          title: 'No Hermes Agent process has left a record of running here.',
          detail:
            `Hermes writes a small status file when it starts. None was found under ` +
            `${homes.join(' or ')}. Either it has never been started on this machine, or it ` +
            `runs somewhere this app cannot see (a different user account, a container, or a ` +
            `different HERMES_HOME).`,
          remedy: input.gatewayReachable
            ? 'Nothing to do — something is answering, so the backend is reachable even though its status file is not visible from here.'
            : 'Start it: run `hermes gateway run`, or use the start button on this screen.',
          data: { searched: homes },
        },
      }
    }

    const live = candidates
      .map((c) => {
        const pid = c.state.pid
        const alive = typeof pid === 'number' && pid > 0 ? isAlive(pid) : false
        return { ...c, alive }
      })
      .find((c) => c.alive)

    if (!live) {
      const stale = candidates[0]
      return {
        running: false,
        liveHome: null,
        finding: {
          id,
          severity: input.gatewayReachable ? 'info' : 'warning',
          title: 'Hermes Agent is installed but is not running right now.',
          detail:
            `Its last recorded process (id ${stale.state.pid ?? 'unknown'}, from ` +
            `${stale.state.path}) is no longer alive.`,
          remedy: input.gatewayReachable
            ? 'Nothing to do — something is answering at this address, so the reachable backend is not the one that wrote this file.'
            : 'Start it: run `hermes gateway run`, or use the start button on this screen.',
          data: { statePath: stale.state.path, pid: stale.state.pid },
        },
      }
    }

    const pid = live.state.pid as number
    const pidVerified = verify(pid)
    const apiServer = live.state.platforms.api_server ?? null
    const platformNames = Object.keys(live.state.platforms)
    const hedge =
      pidVerified === false
        ? ' (Note: process id ' +
          pid +
          ' is alive but does not look like a Hermes process — the id may have been reused.)'
        : ''

    if (input.gatewayReachable) {
      return {
        running: true,
        liveHome: live.home,
        finding: {
          id,
          severity: 'ok',
          title: `Hermes Agent is running (process ${pid}) and answering.`,
          data: {
            pid,
            pidVerified,
            statePath: live.state.path,
            hermesHome: live.home,
            platforms: live.state.platforms,
          },
        },
      }
    }

    if (apiServer === null || apiServer !== 'connected') {
      return {
        running: true,
        liveHome: live.home,
        finding: {
          id,
          severity: 'error',
          title:
            `Hermes Agent is already running (process ${pid}), but it never switched on the web ` +
            `service this app talks to — so nothing is listening at ${input.gatewayUrl}.`,
          detail:
            `The process is alive and reports itself as "${live.state.gatewayState ?? 'running'}", ` +
            `but its own status file (${live.state.path}) lists ` +
            (platformNames.length === 0
              ? 'no active services at all'
              : `only these active services: ${platformNames.join(', ')}`) +
            `. The one this app needs is called "api_server"` +
            (apiServer === null
              ? ' and it is missing entirely.'
              : `, and it is in the "${apiServer}" state.`) +
            ' Starting Hermes again will produce exactly the same result, because the reason it ' +
            'skipped that service is in its settings, not in how it was launched. The settings ' +
            'checks below say which file it read.' +
            hedge,
          remedy:
            'Do not start a second copy. Fix the settings the running one booted with (see below), ' +
            `then restart it: stop process ${pid} and run \`hermes gateway run\` again.`,
          data: {
            pid,
            pidVerified,
            statePath: live.state.path,
            hermesHome: live.home,
            platforms: live.state.platforms,
            apiServerState: apiServer,
          },
        },
      }
    }

    return {
      running: true,
      liveHome: live.home,
      finding: {
        id,
        severity: 'error',
        title:
          `Hermes Agent is running (process ${pid}) and believes its web service is up, but ` +
          `${input.gatewayUrl} is not answering.`,
        detail:
          `Its status file (${live.state.path}) reports api_server as "connected", yet the ` +
          'connection is refused. The usual cause is an address mismatch: it is listening on a ' +
          'different port, or only on an address this app cannot reach.' +
          hedge,
        remedy:
          'Point this app at the address the gateway actually uses by setting HERMES_API_URL in ' +
          'the workspace .env. If the gateway runs on another machine, it must also be started ' +
          'with API_SERVER_HOST=0.0.0.0 so it accepts connections from outside itself.',
        data: {
          pid,
          pidVerified,
          statePath: live.state.path,
          hermesHome: live.home,
          platforms: live.state.platforms,
          apiServerState: apiServer,
        },
      },
    }
  } catch (err) {
    return {
      running: null,
      liveHome: null,
      finding: unknownFinding(id, 'The Hermes Agent process', err),
    }
  }
}

// ── Check: the active profile's .env ──────────────────────────────

/**
 * THE footgun.
 *
 * Hermes reads settings from a `.env` file inside whichever profile is
 * active, and it does **not** fall back to the main one at the root. So
 * switching to a freshly-seeded profile — whose `.env` is created empty —
 * silently blanks every setting the user configured, including the two that
 * make the gateway serve HTTP at all.
 */
export function checkProfileEnv(input: {
  hermesRoot: string
  activeProfile: string
}): DiagnosticFinding {
  const id = 'profile-env'
  const { hermesRoot, activeProfile } = input

  const rootEnvPath = path.join(hermesRoot, '.env')
  const rootKeys = readEnvKeys(rootEnvPath)

  if (!activeProfile || activeProfile === 'default') {
    return {
      id,
      severity: 'ok',
      title:
        'Hermes is using its main settings file — no profile is shadowing it.',
      data: { activeProfile: activeProfile || 'default', rootEnvPath },
    }
  }

  const profileHome = profileHomeFor(hermesRoot, activeProfile)
  const profileEnvPath = path.join(profileHome, '.env')
  const profileKeys = readEnvKeys(profileEnvPath)
  const rootCount = rootKeys?.length ?? 0
  const profileCount = profileKeys?.length ?? 0

  const shared = {
    activeProfile,
    profileEnvPath,
    rootEnvPath,
    profileEnvExists: profileKeys !== null,
    profileSettingCount: profileCount,
    rootSettingCount: rootCount,
  }

  if (profileCount > 0) {
    const missing = (rootKeys ?? []).filter((k) => !profileKeys?.includes(k))
    if (missing.length > 0 && rootCount > 0) {
      return {
        id,
        severity: 'warning',
        title:
          `The settings file for the "${activeProfile}" profile is missing ` +
          `${missing.length} of the ${rootCount} settings your main one has.`,
        detail:
          'Hermes reads settings only from the profile that is currently in use; it never falls ' +
          'back to the main file. Anything listed only in the main file is invisible to the ' +
          `running agent. Missing here: ${missing.slice(0, 12).join(', ')}` +
          (missing.length > 12 ? `, and ${missing.length - 12} more.` : '.') +
          `\nProfile settings file: ${profileEnvPath}` +
          `\nMain settings file: ${rootEnvPath}`,
        remedy:
          `Copy the missing lines across from ${rootEnvPath} into ${profileEnvPath}, then restart ` +
          'the gateway.',
        data: { ...shared, missingKeys: missing },
      }
    }
    return {
      id,
      severity: 'ok',
      title: `The "${activeProfile}" profile has its own settings file with ${profileCount} settings.`,
      data: shared,
    }
  }

  if (rootCount === 0) {
    return {
      id,
      severity: 'info',
      title: `Neither the "${activeProfile}" profile nor the main install has any settings saved yet.`,
      detail:
        `Checked ${profileEnvPath} and ${rootEnvPath}. Both are empty or absent. That is normal on ` +
        'a brand-new install and a problem on an existing one.',
      remedy: 'Run `hermes setup` to configure your providers and keys.',
      data: shared,
    }
  }

  // The payoff case: profile in use, its settings file empty (or absent), the
  // main one full.
  const emptyOrAbsent =
    profileKeys === null ? 'no settings file at all' : 'an empty settings file'
  return {
    id,
    severity: 'error',
    title:
      `Hermes is running as the "${activeProfile}" profile, and that profile has ${emptyOrAbsent} ` +
      `— so all ${rootCount} of your saved settings are being ignored.`,
    detail:
      'A profile is a separate personality for your agent, and each one keeps its own settings ' +
      'file: keys, passwords, and switches such as whether the gateway serves this app at all. ' +
      `When you switch profiles, Hermes reads ONLY that profile's file. It does not fall back to ` +
      "your main one. The profile you are on was created blank, so from the running agent's point " +
      'of view nothing has ever been configured — including API_SERVER_ENABLED and API_SERVER_KEY, ' +
      'the two settings that make it serve this app at all.' +
      `\n\nProfile in use: ${activeProfile}` +
      `\nIts settings file (${profileKeys === null ? 'missing' : 'empty'}): ${profileEnvPath}` +
      `\nYour main settings file (${rootCount} settings): ${rootEnvPath}`,
    remedy:
      `Give the profile your settings and restart the gateway:\n` +
      `    cp ${rootEnvPath} ${profileEnvPath}\n` +
      `Or switch back to the default profile in Settings → Profiles, which uses the main file ` +
      `directly.`,
    data: { ...shared, rootKeys: rootKeys ?? [] },
  }
}

// ── Check: the active profile's config.yaml ───────────────────────

/**
 * The same shadowing problem, one file over. A seeded profile ships a
 * 4-key `config.yaml` where the root has ~21, and the running agent sees only
 * the 4.
 */
export function checkProfileConfig(input: {
  hermesRoot: string
  activeProfile: string
}): DiagnosticFinding {
  const id = 'profile-config'
  const { hermesRoot, activeProfile } = input
  const rootConfigPath = path.join(hermesRoot, 'config.yaml')

  if (!activeProfile || activeProfile === 'default') {
    return {
      id,
      severity: 'ok',
      title: 'Hermes is using its main configuration file.',
      data: { activeProfile: activeProfile || 'default', rootConfigPath },
    }
  }

  const profileHome = profileHomeFor(hermesRoot, activeProfile)
  const profileConfigPath = path.join(profileHome, 'config.yaml')
  const rootKeys = readTopLevelConfigKeys(rootConfigPath)
  const profileKeys = readTopLevelConfigKeys(profileConfigPath)

  const shared = {
    activeProfile,
    profileConfigPath,
    rootConfigPath,
    profileKeyCount: profileKeys?.length ?? 0,
    rootKeyCount: rootKeys?.length ?? 0,
  }

  if (profileKeys === null) {
    return {
      id,
      severity: rootKeys === null ? 'info' : 'warning',
      title: `The "${activeProfile}" profile has no configuration file of its own.`,
      detail:
        `Expected it at ${profileConfigPath}.` +
        (rootKeys === null
          ? ` There is no main one at ${rootConfigPath} either.`
          : ` Your main one at ${rootConfigPath} has ${rootKeys.length} sections, none of which this profile can see.`),
      remedy:
        rootKeys === null
          ? 'Run `hermes setup` to create a configuration.'
          : `Copy your main configuration into the profile, or switch back to the default profile.`,
      data: shared,
    }
  }

  if (rootKeys === null) {
    return {
      id,
      severity: 'ok',
      title: `The "${activeProfile}" profile has its own configuration (${profileKeys.length} sections).`,
      data: shared,
    }
  }

  const missing = rootKeys.filter((k) => !profileKeys.includes(k))
  // A profile is *meant* to override a handful of things (model, providers,
  // description). Only shout when it is missing most of the root's sections —
  // the signature of a bare seeded profile standing in for a full config.
  const looksBare =
    missing.length > 0 && profileKeys.length * 2 < rootKeys.length

  if (!looksBare) {
    return {
      id,
      severity: 'ok',
      title: `The "${activeProfile}" profile's configuration looks complete (${profileKeys.length} sections).`,
      data: { ...shared, missingKeys: missing },
    }
  }

  return {
    id,
    severity: 'warning',
    title:
      `The "${activeProfile}" profile's configuration defines only ${profileKeys.length} sections ` +
      `where your main one defines ${rootKeys.length}.`,
    detail:
      'A profile replaces your configuration rather than adding to it, so anything it does not ' +
      'mention is simply switched off for the running agent. ' +
      `Present in your main configuration but not in this profile: ${missing.slice(0, 12).join(', ')}` +
      (missing.length > 12 ? `, and ${missing.length - 12} more.` : '.') +
      `\nProfile configuration: ${profileConfigPath}` +
      `\nMain configuration: ${rootConfigPath}`,
    remedy:
      `Merge the missing sections from ${rootConfigPath} into ${profileConfigPath}, or switch back ` +
      'to the default profile in Settings → Profiles.',
    data: { ...shared, missingKeys: missing },
  }
}

// ── Check: selected profile vs the one actually being served ──────

export function checkServingProfile(input: {
  selectedProfile: string
  servingProfile: string | null
  scopeMode: 'single' | 'multiplex' | 'unknown'
  servedProfiles: Array<string> | null
}): DiagnosticFinding {
  const id = 'profile-serving'
  const { selectedProfile, servingProfile, scopeMode, servedProfiles } = input

  if (scopeMode === 'unknown') {
    return {
      id,
      severity: 'unknown',
      title: 'Could not confirm which profile the running gateway is serving.',
      detail:
        'The status endpoint that reports this was unreachable or withheld the detail. Your ' +
        `selected profile is "${selectedProfile}".`,
      remedy:
        'If the gateway is down, this will resolve itself once it is back up.',
      data: { selectedProfile, scopeMode },
    }
  }

  if (scopeMode === 'multiplex') {
    const served = servedProfiles ?? []
    if (served.length > 0 && !served.includes(selectedProfile)) {
      return {
        id,
        severity: 'warning',
        title: `The running gateway does not serve your selected profile "${selectedProfile}".`,
        detail: `It is currently serving: ${served.join(', ')}.`,
        remedy: `Select one of the profiles it serves, or restart the gateway so it picks up "${selectedProfile}".`,
        data: { selectedProfile, servedProfiles: served, scopeMode },
      }
    }
    return {
      id,
      severity: 'ok',
      title: `The running gateway serves your selected profile "${selectedProfile}".`,
      data: { selectedProfile, servedProfiles: served, scopeMode },
    }
  }

  if (servingProfile && servingProfile !== selectedProfile) {
    return {
      id,
      severity: 'warning',
      title:
        `You have selected the "${selectedProfile}" profile, but the gateway that is running is ` +
        `still serving "${servingProfile}".`,
      detail:
        'The gateway locks in its profile when it starts, so a profile switch does not take ' +
        'effect until it is restarted. Until then, anything you do here runs against ' +
        `"${servingProfile}" — a different agent, with different settings and different history.`,
      remedy: `Restart the gateway to pick up "${selectedProfile}", or switch back to "${servingProfile}" in Settings → Profiles.`,
      data: { selectedProfile, servingProfile, scopeMode },
    }
  }

  return {
    id,
    severity: 'ok',
    title: `The gateway is serving your selected profile "${selectedProfile}".`,
    data: { selectedProfile, servingProfile, scopeMode },
  }
}

// ── Check: gateway access key ─────────────────────────────────────

/**
 * Compare the token this workspace sends with the one the gateway expects,
 * by fingerprint. Neither value is read into the payload, logged, or
 * returned — only a truncated SHA-256 of each.
 *
 * `gatewayEnvPath` should be the `.env` of the Hermes home the LIVE gateway
 * process booted from (from `checkGatewayProcess`), because that — not the
 * root — is the file it actually read.
 */
export function checkGatewayToken(input: {
  workspaceToken: string
  gatewayEnvPath: string
  rootEnvPath: string
  authError: boolean
}): DiagnosticFinding {
  const id = 'gateway-token'
  const { workspaceToken, gatewayEnvPath, rootEnvPath, authError } = input

  const gatewayKey = readEnvValue(gatewayEnvPath, 'API_SERVER_KEY')
  const rootKey =
    gatewayEnvPath === rootEnvPath
      ? gatewayKey
      : readEnvValue(rootEnvPath, 'API_SERVER_KEY')

  const data = {
    workspaceTokenFingerprint: fingerprint(workspaceToken),
    gatewayKeyFingerprint: fingerprint(gatewayKey),
    rootKeyFingerprint: fingerprint(rootKey),
    gatewayEnvPath,
    rootEnvPath,
  }

  if (!workspaceToken && !gatewayKey) {
    if (rootKey) {
      return {
        id,
        severity: 'warning',
        title:
          'Your main settings define a gateway access key, but the settings file the gateway is ' +
          'actually reading defines none.',
        detail:
          `Nothing sets a key in ${gatewayEnvPath}, while ${rootEnvPath} does. If the gateway ` +
          'boots from the first file it will run with no access key at all — which also means it ' +
          'may not start its web service.',
        remedy: `Copy API_SERVER_KEY (and API_SERVER_ENABLED) from ${rootEnvPath} into ${gatewayEnvPath}, then restart the gateway.`,
        data,
      }
    }
    return {
      id,
      severity: 'ok',
      title: 'No gateway access key is configured on either side.',
      detail: 'That is fine for a local, unauthenticated gateway.',
      data,
    }
  }

  if (workspaceToken && !gatewayKey) {
    return {
      id,
      severity: authError ? 'error' : 'warning',
      title:
        'This app sends a gateway access key, but the gateway has none configured.',
      detail: `Checked ${gatewayEnvPath} for API_SERVER_KEY and found nothing.`,
      remedy: `Either set API_SERVER_KEY in ${gatewayEnvPath} to match, or remove HERMES_API_TOKEN from the workspace .env.`,
      data,
    }
  }

  if (!workspaceToken && gatewayKey) {
    return {
      id,
      severity: 'error',
      title:
        'The gateway requires an access key and this app is not sending one.',
      detail: `The gateway reads its key from ${gatewayEnvPath}; the workspace .env sets no HERMES_API_TOKEN.`,
      remedy: `Set HERMES_API_TOKEN in the workspace .env to the same value as API_SERVER_KEY in ${gatewayEnvPath}.`,
      data,
    }
  }

  if (workspaceToken !== gatewayKey) {
    return {
      id,
      severity: 'error',
      title: 'This app and the gateway are using different access keys.',
      detail:
        `They do not match (this app: ${data.workspaceTokenFingerprint}…, gateway: ` +
        `${data.gatewayKeyFingerprint}… — short fingerprints, not the keys themselves). Every ` +
        'request will be refused until they are identical.',
      remedy: `Copy the value of API_SERVER_KEY from ${gatewayEnvPath} into HERMES_API_TOKEN in the workspace .env, then reload.`,
      data,
    }
  }

  return {
    id,
    severity: 'ok',
    title: 'This app and the gateway are using the same access key.',
    data,
  }
}

// ── Check: local API service access key (fresh-install variant) ──

/**
 * The fresh-install sibling of `checkGatewayToken` above. That check
 * compares two keys that already exist; this one catches the case where the
 * gateway's own startup guard refuses to bring the key-protected service up
 * at all, which looks identical from here (nothing answers, health check
 * times out) but has a different fix.
 *
 * Traced in the gateway source (`~/.hermes/hermes-agent`):
 *  - `gateway/config.py:2007` — `API_SERVER_ENABLED` is read as a truthy
 *    string (`is_truthy_value`, `utils.py:19`: "1"/"true"/"yes"/"on").
 *  - `gateway/config.py:2012` — the `api_server` platform is switched on by
 *    EITHER `API_SERVER_ENABLED` being truthy OR `API_SERVER_KEY` being set —
 *    not both.
 *  - `gateway/platforms/api_server.py:1007` — the key actually used is
 *    `extra.get("key", os.getenv("API_SERVER_KEY", ""))`: a key already
 *    present in `config.yaml`'s `platforms.api_server.extra.key` is used
 *    as-is and is what is live for as long as the env var stays unset —
 *    editing only a `.env` file then visibly changes nothing.
 *  - `gateway/platforms/api_server.py:6019` — `_api_key_passes_startup_guard`
 *    refuses to start with NO key at all, explicitly including loopback-only
 *    binds: this is a real network listener, not a config nicety.
 *  - `gateway/platforms/api_server.py:6029` — separately refuses a key that
 *    fails `hermes_cli.auth.has_usable_secret(key, min_length=16)`
 *    (`hermes_cli/auth.py:556`): shorter than 16 characters, or one of a
 *    fixed set of placeholder strings. Mirrored verbatim below rather than
 *    re-derived, so this reports the same verdict the gateway will reach.
 *
 * This project's own installer sets `API_SERVER_ENABLED=true` and stops
 * there, so a fresh install enables the platform and the gateway then
 * refuses to bind it: the process comes up, other platforms connect, and
 * only `api_server` — the one this workspace talks to — is silently
 * missing. The user sees a health-check timeout and a UI offering to start
 * a gateway that is already running.
 *
 * `gatewayEnvPath`/`configPath` must be the files the LIVE gateway process
 * actually booted from (see `checkGatewayProcess`'s `liveHome`), because
 * under profile scoping neither is necessarily the one at the Hermes root.
 */

const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnvValue(value: string): boolean {
  return TRUTHY_ENV_VALUES.has(value.trim().toLowerCase())
}

/** Verbatim from `hermes_cli/auth.py:540` (`_PLACEHOLDER_SECRET_VALUES`) and
 *  the `min_length=16` the API server passes at `api_server.py:6029` — not
 *  the module's own default of 4, which is used elsewhere for looser
 *  checks. */
const API_SERVER_KEY_MIN_LENGTH = 16
const PLACEHOLDER_API_SERVER_KEYS = new Set([
  '*',
  '**',
  '***',
  'changeme',
  'your_api_key',
  'your_api_key_here',
  'your-api-key',
  'placeholder',
  'example',
  'dummy',
  'null',
  'none',
])

function apiServerKeyIsUsable(value: string): boolean {
  const cleaned = value.trim()
  if (cleaned.length < API_SERVER_KEY_MIN_LENGTH) return false
  return !PLACEHOLDER_API_SERVER_KEYS.has(cleaned.toLowerCase())
}

/**
 * Read a text file while distinguishing "does not exist" (a normal,
 * legitimate state — not every install serves the API, and a profile with
 * no `.env` yet is not evidence of anything broken) from "exists but could
 * not be read" (a permissions problem this check cannot see past, so it
 * must degrade to `unknown` rather than assert "no key configured").
 */
function readTextWithStatus(filePath: string): {
  raw: string | null
  unreadable: boolean
} {
  try {
    return { raw: fs.readFileSync(filePath, 'utf-8'), unreadable: false }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { raw: null, unreadable: false }
    }
    return { raw: null, unreadable: true }
  }
}

/**
 * `platforms.api_server.extra.key` (and its sibling `enabled`) from
 * config.yaml, when present. Returns `null` when the file is absent,
 * unreadable, unparsable, or simply does not mention `api_server` — all of
 * which mean "nothing to say here", not "unknown"; config.yaml not
 * mentioning this platform at all is the common case.
 */
function readConfiguredApiServer(configPath: string): {
  enabled: boolean
  key: string
} | null {
  const raw = readTextOrNull(configPath)
  if (raw === null) return null
  try {
    const parsed = YAML.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const platforms = (parsed as Record<string, unknown>).platforms
    if (!platforms || typeof platforms !== 'object') return null
    const apiServer = (platforms as Record<string, unknown>).api_server
    if (!apiServer || typeof apiServer !== 'object') return null
    const section = apiServer as Record<string, unknown>
    const extra = section.extra
    const key =
      extra && typeof extra === 'object'
        ? (extra as Record<string, unknown>).key
        : undefined
    return {
      enabled: section.enabled === true,
      key: typeof key === 'string' ? key : '',
    }
  } catch {
    return null
  }
}

export function checkApiServerKey(input: {
  gatewayEnvPath: string
  configPath: string
}): DiagnosticFinding {
  const id = 'api-server-key'
  const { gatewayEnvPath, configPath } = input

  const envStatus = readTextWithStatus(gatewayEnvPath)
  if (envStatus.unreadable) {
    return {
      id,
      severity: 'unknown',
      title:
        "Could not check whether the gateway's local API service has a working access key.",
      detail:
        `${gatewayEnvPath} exists but this app could not read it — most likely a file-permission ` +
        'problem, not a missing setting. Whether the service can start is unknown until this file ' +
        'is readable again.',
      remedy: `Make sure this app's user account can read ${gatewayEnvPath}, then reload this page.`,
      data: { gatewayEnvPath, configPath },
    }
  }

  const envRaw = envStatus.raw ?? ''
  const envEnabled = isTruthyEnvValue(
    extractEnvValue(envRaw, 'API_SERVER_ENABLED'),
  )
  const envKey = extractEnvValue(envRaw, 'API_SERVER_KEY')

  const configured = readConfiguredApiServer(configPath)
  const configKey = configured?.key ?? ''
  // A key alone does not switch the platform on (verified against
  // `PlatformConfig.from_dict`, `gateway/config.py:668`: `enabled` defaults
  // to `False` and is read only from an explicit `enabled` key) — it takes
  // one of: an explicit `enabled: true` in config.yaml, or either env var
  // being truthy.
  const enabled = envEnabled || Boolean(envKey) || Boolean(configured?.enabled)

  const data = {
    gatewayEnvPath,
    configPath,
    enabled,
    envServerEnabled: envEnabled,
    configEnabled: configured?.enabled ?? false,
    envKeyFingerprint: fingerprint(envKey),
    configKeyFingerprint: fingerprint(configKey),
  }

  if (!enabled) {
    return {
      id,
      severity: 'ok',
      title:
        "This install is not set up to expose the agent's local API service, so no access key is needed for it.",
      detail:
        'Most setups never turn this on — it only matters if something (such as this workspace) needs to reach ' +
        `the agent directly over HTTP. Checked ${gatewayEnvPath} and ${configPath}; neither switches it on.`,
      data,
    }
  }

  // The service IS switched on. If config.yaml already sets a key and the
  // env file sets none, that config value — not any .env file — is what the
  // gateway is actually using right now.
  if (configKey && !envKey) {
    const weak = !apiServerKeyIsUsable(configKey)
    return {
      id,
      severity: weak ? 'error' : 'info',
      title: weak
        ? "The access key set directly in the gateway's configuration file is too weak, so its local API service will refuse to start."
        : "The agent's local API service is using an access key set directly in its configuration file, not in a settings (.env) file.",
      detail:
        `${configPath} sets platforms.api_server.extra.key directly, and ${gatewayEnvPath} sets no ` +
        'API_SERVER_KEY. That configuration value is what the gateway actually uses right now — if you edit only ' +
        'a .env file to fix this, nothing will visibly change, because nothing there is in force. Setting ' +
        'API_SERVER_KEY in the env file above WOULD take over, but only starting the next time the gateway ' +
        'restarts.' +
        (weak
          ? ' On top of that, the configured value is too short or a recognizable placeholder, which the gateway ' +
            'refuses outright regardless of which file it came from.'
          : ''),
      remedy: weak
        ? 'Generate a real secret and set it on both sides — a key on only one side just moves the failure:\n' +
          '    openssl rand -hex 32\n' +
          `Put the result in API_SERVER_KEY in ${gatewayEnvPath} (this takes over on the next restart, replacing ` +
          `the configured value) and in HERMES_API_TOKEN in this workspace's .env, then restart the gateway.`
        : 'Nothing is broken — this is only worth knowing if a future .env edit here does not seem to do ' +
          `anything. To change this key: edit platforms.api_server.extra.key in ${configPath} directly, or set ` +
          `API_SERVER_KEY in ${gatewayEnvPath} (it takes over on the next restart). Either way, keep ` +
          "HERMES_API_TOKEN in this workspace's .env matching whichever one wins.",
      data,
    }
  }

  const effectiveKey = envKey || configKey

  if (!effectiveKey) {
    return {
      id,
      severity: 'error',
      title:
        "The agent's local API service is switched on but has no access key, so it will refuse to start.",
      detail:
        'A "local API service" is the door this workspace (and any other tool) uses to reach the agent ' +
        'directly, instead of through a chat app. Hermes refuses to open that door without a key protecting it — ' +
        'even when everything runs on one machine, because an unlocked door to an agent that can run commands on ' +
        `this computer is too dangerous to leave open by accident. ${gatewayEnvPath} switches the service on ` +
        '(API_SERVER_ENABLED) but never sets API_SERVER_KEY next to it. This is a common gap on a fresh install, ' +
        'not a sign anything else is wrong: the health-check timeout and the button offering to start a gateway ' +
        'that is already running are both downstream of exactly this.',
      remedy:
        'Generate one key and set it on both sides — a key on only one side just moves the failure to the other ' +
        'one:\n' +
        '    openssl rand -hex 32\n' +
        `Put the result in API_SERVER_KEY in ${gatewayEnvPath} (the agent's settings) and in HERMES_API_TOKEN in ` +
        "this workspace's .env (a separate file). Then restart the gateway.",
      data,
    }
  }

  if (!apiServerKeyIsUsable(effectiveKey)) {
    return {
      id,
      severity: 'error',
      title:
        "The agent's local API service has an access key, but the gateway considers it too weak and will refuse to start.",
      detail:
        'The gateway requires a real secret here: at least 16 characters, and not one of a handful of obvious ' +
        'placeholders (things like "changeme", "placeholder", or "your_api_key"). The key currently set in ' +
        `${gatewayEnvPath} does not clear that bar, so the gateway logs a refusal and never opens the service, ` +
        'even though everything looks "enabled".',
      remedy:
        'Replace it with a real random value and set it on both sides:\n' +
        '    openssl rand -hex 32\n' +
        `Put the result in API_SERVER_KEY in ${gatewayEnvPath} and in HERMES_API_TOKEN in this workspace's .env, ` +
        'then restart the gateway.',
      data,
    }
  }

  return {
    id,
    severity: 'ok',
    title: "The agent's local API service has a working access key configured.",
    data,
  }
}

// ── Capability naming ─────────────────────────────────────────────

const CORE_CAPABILITY_KEYS = [
  'health',
  'chatCompletions',
  'models',
  'streaming',
] as const
const ENHANCED_CAPABILITY_KEYS = [
  'sessions',
  'enhancedChat',
  'skills',
  'memory',
  'config',
  'jobs',
  'mcp',
  'conductor',
  'kanban',
  'projects',
] as const

/** Human labels so the UI can name what is missing rather than saying
 *  "backend not connected". */
export const CAPABILITY_LABELS: Record<string, string> = {
  health: 'health checks',
  chatCompletions: 'chat',
  models: 'model list',
  streaming: 'streaming replies',
  sessions: 'sessions',
  enhancedChat: 'enhanced chat',
  skills: 'skills',
  memory: 'memory',
  config: 'settings',
  jobs: 'jobs',
  mcp: 'MCP servers',
  conductor: 'conductor',
  kanban: 'task board',
  projects: 'projects',
  dashboard: 'dashboard',
}

export function listMissingCapabilities(
  caps: GatewayCapabilities,
): Array<string> {
  const missing: Array<string> = []
  for (const key of CORE_CAPABILITY_KEYS) {
    if (!caps[key]) missing.push(key)
  }
  for (const key of ENHANCED_CAPABILITY_KEYS) {
    if (!caps[key]) missing.push(key)
  }
  if (!caps.dashboard.available) missing.push('dashboard')
  return missing
}

// ── Install evidence / first run ──────────────────────────────────

/**
 * Is there any sign Hermes has ever been set up on this machine?
 *
 * A genuinely new user gets the welcome screen; a broken install gets the
 * diagnosis. Getting this backwards in either direction is the failure this
 * whole module is guarding against, so the test is deliberately generous:
 * ANY of these means "not a first run".
 */
export function hasInstallEvidence(hermesRoot: string): boolean {
  try {
    if (!fs.existsSync(hermesRoot)) return false
    const markers = [
      path.join(hermesRoot, 'config.yaml'),
      path.join(hermesRoot, '.env'),
      path.join(hermesRoot, 'gateway_state.json'),
      path.join(hermesRoot, 'active_profile'),
    ]
    if (markers.some((m) => fs.existsSync(m))) return true
    const profilesDir = path.join(hermesRoot, 'profiles')
    if (fs.existsSync(profilesDir)) {
      return fs.readdirSync(profilesDir).length > 0
    }
    return false
  } catch {
    // Unreadable root — assume an install exists rather than greeting an
    // existing user as brand new.
    return true
  }
}

// ── Orchestrator ──────────────────────────────────────────────────

export type RunSetupDiagnosticsDeps = {
  hermesRoot?: string
  gatewayUrl?: string
  dashboardUrl?: string
  capabilities?: () => Promise<GatewayCapabilities>
  scope?: () => Promise<{
    mode: 'single' | 'multiplex' | 'unknown'
    servedProfiles: Array<string> | null
    activeProfile: string | null
  }>
  workspaceToken?: string
  isProcessAlive?: (pid: number) => boolean
  verifyPidIdentity?: (pid: number) => boolean | null
}

/**
 * Run every check. NEVER throws and never rejects: each check degrades to
 * `unknown` on its own, and the orchestrator itself is wrapped so that even a
 * total failure yields a well-formed report.
 */
export async function runSetupDiagnostics(
  deps: RunSetupDiagnosticsDeps = {},
): Promise<SetupDiagnostics> {
  const generatedAt = new Date().toISOString()

  let hermesRoot: string
  try {
    hermesRoot = deps.hermesRoot ?? getHermesRoot()
  } catch {
    hermesRoot = ''
  }
  const gatewayUrl = deps.gatewayUrl ?? CLAUDE_API
  const dashboardUrl = deps.dashboardUrl ?? CLAUDE_DASHBOARD_URL

  const findings: Array<DiagnosticFinding> = []

  // 1. Reachability — reuses the shared probe rather than issuing its own.
  let caps: GatewayCapabilities | null = null
  try {
    caps = await (deps.capabilities ?? ensureGatewayProbed)()
  } catch {
    caps = null
  }

  if (caps) {
    findings.push(
      safeCheck('gateway-reachability', 'Gateway reachability', () =>
        checkGatewayReachability(caps, gatewayUrl),
      ),
    )
  } else {
    findings.push(
      unknownFinding(
        'gateway-reachability',
        'Gateway reachability',
        new Error('The capability probe did not complete.'),
      ),
    )
  }

  const gatewayReachable = Boolean(
    caps && (caps.health || caps.chatCompletions) && !caps.authError,
  )

  // 2. Active profile — every filesystem check below is scoped by it.
  let activeProfile = 'default'
  try {
    activeProfile = hermesRoot ? readActiveProfileName(hermesRoot) : 'default'
  } catch {
    activeProfile = 'default'
  }

  // 3. Process — is something already running, and did it bind anything?
  const processResult = checkGatewayProcess({
    hermesRoot,
    activeProfile,
    gatewayUrl,
    gatewayReachable,
    isProcessAlive: deps.isProcessAlive,
    verifyPidIdentity: deps.verifyPidIdentity,
  })
  findings.push(processResult.finding)

  // 4 & 5. Profile shadowing — the settings and the configuration.
  findings.push(
    safeCheck('profile-env', "The active profile's settings file", () =>
      checkProfileEnv({ hermesRoot, activeProfile }),
    ),
  )
  findings.push(
    safeCheck('profile-config', "The active profile's configuration", () =>
      checkProfileConfig({ hermesRoot, activeProfile }),
    ),
  )

  // 6. Selected vs serving.
  findings.push(
    await safeCheckAsync('profile-serving', 'The serving profile', async () => {
      const topology = await (deps.scope ?? getGatewayScopeMode)()
      return checkServingProfile({
        selectedProfile: activeProfile,
        servingProfile: topology.activeProfile,
        scopeMode: topology.mode,
        servedProfiles: topology.servedProfiles,
      })
    }),
  )

  // The home the LIVE gateway process booted from, when known — under
  // profile scoping this is not necessarily the Hermes root, and getting it
  // wrong would send the user to edit a file the gateway never reads.
  const liveHome =
    processResult.liveHome ?? profileHomeFor(hermesRoot, activeProfile)

  // 7. Access key — compared against the .env of the home the LIVE process
  //    booted from when we know it, the active profile's otherwise.
  findings.push(
    safeCheck('gateway-token', 'The gateway access key', () =>
      checkGatewayToken({
        workspaceToken:
          deps.workspaceToken ??
          process.env.HERMES_API_TOKEN ??
          process.env.CLAUDE_API_TOKEN ??
          '',
        gatewayEnvPath: path.join(liveHome, '.env'),
        rootEnvPath: path.join(hermesRoot, '.env'),
        authError: Boolean(caps?.authError),
      }),
    ),
  )

  // 8. The api_server startup guard — the fresh-install variant of #7: not
  //    "the keys disagree" but "the platform is enabled and refuses to bind
  //    at all", which #7 alone cannot distinguish from "no key configured
  //    anywhere".
  findings.push(
    safeCheck('api-server-key', "The agent's local API service key", () =>
      checkApiServerKey({
        gatewayEnvPath: path.join(liveHome, '.env'),
        configPath: path.join(liveHome, 'config.yaml'),
      }),
    ),
  )

  let firstRun = false
  try {
    firstRun = hermesRoot ? !hasInstallEvidence(hermesRoot) : false
  } catch {
    firstRun = false
  }

  return {
    generatedAt,
    gatewayUrl,
    dashboardUrl,
    severity: worstSeverity(findings),
    gatewayProcessRunning: processResult.running,
    missingCapabilities: caps ? listMissingCapabilities(caps) : [],
    firstRun,
    findings,
  }
}
