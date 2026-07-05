/**
 * Terminal sessions using Python PTY helper.
 * Gives us real PTY (echo, colors, resize) without node-pty native addon.
 */
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import EventEmitter from 'node:events'
import { assertAllowedCwd } from './terminal-cwd-guard'
import type { ChildProcess } from 'node:child_process'

/**
 * Binary allowlist for terminal sessions.
 *
 * Only basenames listed here may be used as the first element of `command`.
 * Operators can extend the list via TERMINAL_ALLOWED_BINARIES (comma-separated
 * basenames, e.g. `TERMINAL_ALLOWED_BINARIES=fish,tmux`).
 *
 * Absolute paths are accepted only when their basename is in the allowlist
 * AND the path does not contain `..` traversal components.
 */
const DEFAULT_ALLOWED_BINARIES = new Set([
  'bash',
  'sh',
  'zsh',
  'fish',
  'dash',
  'ksh',
  'tcsh',
  'csh',
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
])

const ALLOWED_BINARIES: Set<string> = (() => {
  const extra = (process.env.TERMINAL_ALLOWED_BINARIES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return new Set([...DEFAULT_ALLOWED_BINARIES, ...extra])
})()

/**
 * Validate that `bin` is an allowed shell binary.
 * Returns a rejection reason string, or null if valid.
 */
export function isAllowedTerminalBinary(bin: string): string | null {
  if (bin.includes('..')) {
    return 'Command path must not contain traversal components (..)'
  }
  const name = basename(bin)
  if (!ALLOWED_BINARIES.has(name)) {
    return `Binary "${name}" is not in the terminal allowlist. Set TERMINAL_ALLOWED_BINARIES to extend.`
  }
  return null
}

export type TerminalSessionEvent = {
  event: string
  payload: unknown
}

export type TerminalSession = {
  id: string
  createdAt: number
  emitter: EventEmitter
  sendInput: (data: string) => void
  resize: (cols: number, rows: number) => void
  close: () => void
  /**
   * Mark that all live SSE listeners have detached. Starts an idle timer that
   * will reap the PTY if no listener reattaches in time. Lets the session
   * survive transient disconnects (network blips, browser tab suspension,
   * HMR reload) without killing the user's shell. See #298.
   */
  markDetached: () => void
  /** Cancel a pending detached-reap timer (called when a new listener attaches). */
  markAttached: () => void
}

// How long an unattached PTY session stays alive before it's reaped, in ms.
// Long enough to absorb tab suspension and short network blips, short enough
// that abandoned tabs don't pile up forever. Override with HERMES_TERMINAL_DETACH_TTL_MS.
const DETACH_TTL_MS = (() => {
  const raw = process.env.HERMES_TERMINAL_DETACH_TTL_MS
  const parsed = raw ? Number(raw) : NaN
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed)
  return 5 * 60_000 // 5 minutes
})()

const sessions = new Map<string, TerminalSession>()

// Resolve path to pty-helper.py relative to this file
const __dirname_resolved =
  typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url))
const PTY_HELPER = resolve(__dirname_resolved, 'pty-helper.py')

export function createTerminalSession(params: {
  command?: Array<string>
  cwd?: string
  env?: Record<string, string>
  cols?: number
  rows?: number
}): TerminalSession {
  const emitter = new EventEmitter()
  const sessionId = randomUUID()

  const home = process.env.HOME ?? homedir()
  const defaultShell =
    process.platform === 'win32'
      ? 'powershell.exe'
      : process.platform === 'darwin'
        ? '/bin/zsh'
        : '/bin/bash'
  const command = params.command?.length
    ? params.command
    : [process.env.SHELL ?? defaultShell]

  // Validate the binary against the allowlist before spawning.
  const binaryError = isAllowedTerminalBinary(command[0])
  if (binaryError) {
    throw Object.assign(new Error(binaryError), { code: 'BINARY_NOT_ALLOWED' })
  }
  // Validate and resolve the requested cwd against the allowed roots.
  // assertAllowedCwd handles ~ expansion, `..` collapsing, and symlink
  // resolution, then throws CWD_NOT_ALLOWED if the result escapes the roots.
  let cwd: string
  try {
    cwd = assertAllowedCwd(params.cwd ?? home)
  } catch (err) {
    throw Object.assign(
      new Error(
        err instanceof Error ? err.message : 'Invalid working directory',
      ),
      { code: 'CWD_NOT_ALLOWED' },
    )
  }

  const cols = params.cols ?? 80
  const rows = params.rows ?? 24

  // Buffer early output before any listener registers
  const earlyBuffer: Array<TerminalSessionEvent> = []
  let hasListeners = false

  emitter.on('newListener', (eventName) => {
    if (eventName === 'event' && !hasListeners) {
      hasListeners = true
      process.nextTick(() => {
        for (const evt of earlyBuffer) {
          emitter.emit('event', evt)
        }
        earlyBuffer.length = 0
      })
    }
  })

  const pushEvent = (evt: TerminalSessionEvent) => {
    if (hasListeners) {
      emitter.emit('event', evt)
    } else {
      earlyBuffer.push(evt)
    }
  }

  // Spawn Python PTY helper
  const proc: ChildProcess = spawn(
    'python3',
    [PTY_HELPER, cwd, String(cols), String(rows), '--', ...command],
    {
      env: {
        ...process.env,
        ...params.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        COLUMNS: String(cols),
        LINES: String(rows),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )

  proc.stdout?.on('data', (data: Buffer) => {
    pushEvent({
      event: 'data',
      payload: { data: data.toString() },
    })
  })

  // stderr from the helper itself (not the shell)
  proc.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString()
    if (msg.trim()) {
      if (import.meta.env.DEV) console.error('[pty-helper stderr]', msg)
    }
  })

  proc.on('exit', (exitCode, signal) => {
    pushEvent({
      event: 'exit',
      payload: { exitCode, signal: signal ?? undefined },
    })
    emitter.emit('close')
    sessions.delete(sessionId)
  })

  proc.on('error', (err) => {
    pushEvent({
      event: 'error',
      payload: { message: err.message },
    })
  })

  let detachTimer: ReturnType<typeof setTimeout> | null = null

  const session: TerminalSession = {
    id: sessionId,
    createdAt: Date.now(),
    emitter,

    sendInput(data: string) {
      if (proc.stdin?.writable) {
        proc.stdin.write(data)
      }
    },

    resize(_newCols: number, _newRows: number) {
      // Send SIGWINCH to the Python helper, which propagates to the PTY
      if (proc.pid) {
        // Note: can't update env on running ChildProcess, SIGWINCH alone is sent
        try {
          process.kill(proc.pid, 'SIGWINCH')
        } catch {
          /* */
        }
      }
    },

    markDetached() {
      if (detachTimer) clearTimeout(detachTimer)
      detachTimer = setTimeout(() => {
        detachTimer = null
        // Only reap if the session is still in the map and the proc is alive.
        if (sessions.get(sessionId) === session) {
          session.close()
        }
      }, DETACH_TTL_MS)
    },

    markAttached() {
      if (detachTimer) {
        clearTimeout(detachTimer)
        detachTimer = null
      }
    },

    close() {
      if (detachTimer) {
        clearTimeout(detachTimer)
        detachTimer = null
      }
      try {
        proc.kill('SIGTERM')
        setTimeout(() => {
          try {
            proc.kill('SIGKILL')
          } catch {
            /* */
          }
        }, 2000)
      } catch {
        /* */
      }
      sessions.delete(sessionId)
    },
  }

  sessions.set(sessionId, session)
  return session
}

export function getTerminalSession(id: string): TerminalSession | null {
  return sessions.get(id) ?? null
}

export function closeTerminalSession(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  session.close()
}
