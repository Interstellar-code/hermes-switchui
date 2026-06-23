import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'

const CLAUDE_HEALTH_TIMEOUT_MS = 2_000
const CLAUDE_STARTUP_TIMEOUT_MS = 10_000
const CLAUDE_STARTUP_POLL_INTERVAL_MS = 1_000
const DEFAULT_GATEWAY_PORT = 8642

let startPromise: Promise<StartClaudeAgentResult> | null = null

export type StartClaudeAgentResult =
  | {
      ok: true
      message: string
      pid?: number
    }
  | {
      ok: false
      error: string
    }

/**
 * Read ~/.hermes/.env and return key=value pairs as an object.
 * Silently returns {} if the file doesn't exist or can't be parsed.
 */
function readClaudeEnv(): Record<string, string> {
  const envPath = join(
    process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? join(homedir(), '.hermes'),
    '.env',
  )
  try {
    const raw = readFileSync(envPath, 'utf-8')
    const result: Record<string, string> = {}
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx <= 0) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let value = trimmed.slice(eqIdx + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (key) result[key] = value
    }
    return result
  } catch {
    return {}
  }
}

/** Parse a port out of a URL string; returns null if absent/invalid. */
function parsePort(url: string | undefined): number | null {
  if (!url?.trim()) return null
  try {
    const u = new URL(url.trim())
    if (u.port) return Number(u.port)
    // No explicit port → infer from scheme
    return u.protocol === 'https:' ? 443 : 80
  } catch {
    return null
  }
}

/**
 * Resolve the gateway port the running agent actually uses, in priority order:
 *   1. HERMES_API_URL / CLAUDE_API_URL (what switchui is configured to talk to —
 *      install.sh writes this from GATEWAY_PORT).
 *   2. API_SERVER_PORT in the gateway's own ~/.hermes/.env.
 *   3. Default 8642.
 * This lets a gateway running on a custom port be detected instead of hardcoding 8642.
 */
export function resolveGatewayPort(): number {
  const fromUrl =
    parsePort(process.env.HERMES_API_URL) ?? parsePort(process.env.CLAUDE_API_URL)
  if (fromUrl) return fromUrl

  const env = readClaudeEnv()
  const fromEnv = Number(env.API_SERVER_PORT)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv

  return DEFAULT_GATEWAY_PORT
}

/** Base URL of the gateway switchui should probe/start. Honors a custom host. */
export function resolveGatewayUrl(): string {
  const configured = process.env.HERMES_API_URL?.trim() || process.env.CLAUDE_API_URL?.trim()
  if (configured) {
    try {
      return new URL(configured).origin
    } catch {
      /* fall through to localhost + resolved port */
    }
  }
  return `http://127.0.0.1:${resolveGatewayPort()}`
}

/** Look up an executable by name on PATH (first hit wins). */
function findOnPath(name: string): string | null {
  const pathEnv = process.env.PATH
  if (!pathEnv) return null
  for (const dir of pathEnv.split(':')) {
    if (!dir) continue
    const candidate = resolve(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Same directory resolution logic as vite.config.ts. Kept in sync. */
export function resolveClaudeAgentDir(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const candidates: Array<string> = []

  if (env.CLAUDE_AGENT_PATH?.trim()) {
    candidates.push(env.CLAUDE_AGENT_PATH.trim())
  }

  const workspaceRoot = dirname(resolve('.'))
  candidates.push(
    resolve(workspaceRoot, 'hermes-agent'),          // sibling (old README)
    resolve(workspaceRoot, '..', 'hermes-agent'),    // one level up
    resolve(homedir(), '.hermes', 'hermes-agent'),   // Nous installer default
    resolve(homedir(), 'hermes-agent'),              // ~/hermes-agent
  )

  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, 'webapi'))) return candidate
  }

  return null
}

/**
 * Find the gateway CLI binary. The Interstellar fork installer ships `hermes`
 * (to ~/.hermes/bin or ~/.local/bin); legacy Nous installs shipped `claude`.
 * Checks well-known locations first, then falls back to a PATH lookup.
 */
export function resolveClaudeBinary(): string | null {
  const candidates = [
    resolve(homedir(), '.hermes', 'bin', 'hermes'),
    resolve(homedir(), '.local', 'bin', 'hermes'),
    // legacy Nous 'claude' binary
    resolve(homedir(), '.claude', 'bin', 'claude'),
    resolve(homedir(), '.local', 'bin', 'claude'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return findOnPath('hermes') ?? findOnPath('claude')
}

export function resolveClaudePython(agentDir: string): string {
  const venvPython = resolve(agentDir, '.venv', 'bin', 'python')
  if (existsSync(venvPython)) return venvPython
  const uvVenv = resolve(agentDir, 'venv', 'bin', 'python')
  if (existsSync(uvVenv)) return uvVenv
  // Nous installer ships its own uv-managed python alongside the binary
  const nousPython = resolve(homedir(), '.claude', 'venv', 'bin', 'python')
  if (existsSync(nousPython)) return nousPython
  return 'python3'
}

export async function isClaudeAgentHealthy(
  baseUrl: string = resolveGatewayUrl(),
): Promise<boolean> {
  try {
    const response = await fetch(new URL('/health', baseUrl), {
      signal: AbortSignal.timeout(CLAUDE_HEALTH_TIMEOUT_MS),
    })
    return response.ok
  } catch {
    return false
  }
}

/** Maximum time startClaudeAgent waits for the gateway to become healthy. */
export const STARTUP_TIMEOUT_MS = CLAUDE_STARTUP_TIMEOUT_MS
/** Poll interval for health checks during startup. */
export const STARTUP_POLL_INTERVAL_MS = CLAUDE_STARTUP_POLL_INTERVAL_MS

// Test-only knob: lets the unit test collapse the 10s real wait to a few
// ms without touching the production default. Production callers leave
// this alone.
let startupTimeoutOverrideMs: number | null = null
/** @internal — only vitest should call this. */
export function __setStartupTimeoutForTests(ms: number | null): void {
  startupTimeoutOverrideMs = ms
}

function effectiveStartupTimeoutMs(): number {
  return startupTimeoutOverrideMs ?? CLAUDE_STARTUP_TIMEOUT_MS
}

/**
 * Poll isClaudeAgentHealthy() until it returns true or the timeout elapses.
 * Exported for testability — production callers should use startClaudeAgent().
 */
export async function waitForClaudeAgentHealthy(
  baseUrl: string = resolveGatewayUrl(),
  timeoutMs: number = CLAUDE_STARTUP_TIMEOUT_MS,
  intervalMs: number = CLAUDE_STARTUP_POLL_INTERVAL_MS,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
  probe: (url: string) => Promise<boolean> = isClaudeAgentHealthy,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probe(baseUrl)) return true
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await sleep(Math.min(intervalMs, remaining))
  }
  return probe(baseUrl)
}

export async function startClaudeAgent(): Promise<StartClaudeAgentResult> {
  if (await isClaudeAgentHealthy()) {
    return { ok: true, message: 'already running' }
  }

  if (startPromise) {
    return startPromise
  }

  startPromise = (async () => {
    try {
      const claudeEnv = readClaudeEnv()
      const claudeBin = resolveClaudeBinary()
      const agentDir = resolveClaudeAgentDir()

      // Prefer the `hermes gateway run` binary path (the Nous installer's
      // canonical entrypoint). Fall back to launching uvicorn against the
      // source tree if we only have a directory.
      let command: string
      let commandArgs: Array<string>
      let cwd: string | undefined

      if (claudeBin) {
        command = claudeBin
        commandArgs = ['gateway', 'run']
        cwd = agentDir ?? undefined
      } else if (agentDir) {
        command = resolveClaudePython(agentDir)
        commandArgs = [
          '-m',
          'uvicorn',
          'webapi.app:app',
          '--host',
          '0.0.0.0',
          '--port',
          String(resolveGatewayPort()),
        ]
        cwd = agentDir
      } else {
        return {
          ok: false,
          error:
            "hermes-agent not found. Run the installer: curl -fsSL https://hermes-switchui.com/install.sh | bash",
        }
      }

      const child = spawn(
        command,
        commandArgs,
        {
          cwd,
          detached: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            ...claudeEnv,
            PATH: [
              resolve(homedir(), '.claude', 'bin'),
              resolve(homedir(), '.local', 'bin'),
              agentDir ? resolve(agentDir, '.venv', 'bin') : '',
              agentDir ? resolve(agentDir, 'venv', 'bin') : '',
              process.env.PATH || '',
            ].filter(Boolean).join(':'),
          },
        },
      )

      child.unref()

      const gatewayUrl = resolveGatewayUrl()
      const healthy = await waitForClaudeAgentHealthy(
        gatewayUrl,
        effectiveStartupTimeoutMs(),
      )

      if (healthy) {
        return {
          ok: true,
          pid: child.pid,
          message: 'started',
        }
      }

      return {
        ok: false,
        error: `Gateway spawned (pid: ${child.pid ?? 'unknown'}) but did not become healthy at ${gatewayUrl} within ${CLAUDE_STARTUP_TIMEOUT_MS}ms`,
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })()

  try {
    return await startPromise
  } finally {
    startPromise = null
  }
}
