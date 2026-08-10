import { useEffect, useRef, useState } from 'react'
import type { AuthStatus } from '@/lib/claude-auth'
import { writeTextToClipboard } from '@/lib/clipboard'
import { fetchClaudeAuthStatus } from '@/lib/claude-auth'

const POLL_INTERVAL_MS = 2_000
const FAILURE_REVEAL_MS = 5_000
// Fire one silent auto-start attempt this many ms after we still can't connect.
const AUTO_START_DELAY_MS = 4_000

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

// ── Diagnostics ───────────────────────────────────────────────────
// Structurally mirrors `src/server/setup-diagnostics.ts`'s exported types.
// Declared locally rather than imported so nothing in this client component
// can ever pull the server module (and its node:fs import) into the bundle.

type DiagnosticSeverity = 'ok' | 'info' | 'unknown' | 'warning' | 'error'

type DiagnosticFinding = {
  id: string
  severity: DiagnosticSeverity
  title: string
  detail?: string
  remedy?: string
}

type SetupDiagnostics = {
  severity: DiagnosticSeverity
  /** `true` → a gateway is already up; Auto-Start cannot help and must not be
   *  offered. `null` → unknown, so prefer the non-destructive action. */
  gatewayProcessRunning: boolean | null
  missingCapabilities: Array<string>
  /** No sign of a Hermes install at all — a genuinely new user, who should
   *  see the welcome rather than a diagnostic dump. */
  firstRun: boolean
  findings: Array<DiagnosticFinding>
  gatewayUrl?: string
}

/** Labels so the screen can name what is missing instead of saying
 *  "backend not connected". Keys match the gateway capability keys. */
const CAPABILITY_LABELS: Record<string, string> = {
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

const SEVERITY_STYLES: Record<
  DiagnosticSeverity,
  { box: string; dot: string; label: string; text: string }
> = {
  error: {
    box: 'border-red-500/25 bg-red-950/30',
    dot: 'bg-red-400',
    label: 'Blocking',
    text: 'text-red-300',
  },
  warning: {
    box: 'border-amber-500/25 bg-amber-950/30',
    dot: 'bg-amber-400',
    label: 'Check this',
    text: 'text-amber-300',
  },
  unknown: {
    box: 'border-white/10 bg-white/5',
    dot: 'bg-white/40',
    label: 'Unknown',
    text: 'text-white/60',
  },
  info: {
    box: 'border-sky-500/20 bg-sky-950/25',
    dot: 'bg-sky-400',
    label: 'Note',
    text: 'text-sky-300',
  },
  ok: {
    box: 'border-emerald-500/20 bg-emerald-950/25',
    dot: 'bg-emerald-400',
    label: 'OK',
    text: 'text-emerald-300',
  },
}

const SEVERITY_ORDER: Record<DiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  unknown: 2,
  info: 3,
  ok: 4,
}

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('win')) return 'windows'
  if (ua.includes('mac')) return 'macos'
  if (ua.includes('linux')) return 'linux'
  return 'unknown'
}

function getSetupSteps(
  platform: Platform,
): Array<{ title: string; command: string; note?: string }> {
  return [
    {
      title: 'Use any OpenAI-compatible backend',
      command: 'Set HERMES_API_URL to your backend base URL',
      note: 'Portable chat works with any backend that exposes /v1/chat/completions (Ollama, LiteLLM, vLLM, etc.)',
    },
    {
      title: 'Optional: install Hermes Agent locally',
      command:
        'curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash',
      note: 'Vanilla hermes-agent unlocks sessions, skills, memory, jobs, and config automatically — no fork required',
    },
    {
      title: 'Set up your agent',
      command: 'hermes setup',
      note: 'Pick your providers once; Hermes Agent stores them under ~/.hermes',
    },
    {
      title: 'Start the gateway',
      command: 'hermes gateway run',
      note: 'This starts the HTTP API on :8642 for the workspace',
    },
  ]
}

/**
 * Should the screen show a diagnosis instead of the welcome?
 *
 * A real first run and a broken install are different situations and must
 * look different. We only replace the welcome when we have a diagnosis AND it
 * says this machine has an install (`firstRun === false`). Everything else —
 * no diagnostics, diagnostics still loading, a genuinely fresh machine —
 * keeps the original welcome path exactly as it was.
 *
 * `info` findings do not qualify: "nothing configured yet" is a description
 * of a fresh setup, not a fault, and does not deserve to take over the
 * screen. `unknown` does qualify — the user is already stuck on a screen that
 * will not connect, and "we could not check X" is a real lead.
 */
export function shouldShowDiagnostics(
  diagnostics: SetupDiagnostics | null,
): diagnostics is SetupDiagnostics {
  if (!diagnostics) return false
  if (diagnostics.firstRun) return false
  return diagnostics.findings.some(
    (f) =>
      f.severity === 'error' ||
      f.severity === 'warning' ||
      f.severity === 'unknown',
  )
}

/**
 * Auto-Start is only honest when nothing is running. `true` means a gateway
 * is already up (starting a second is the useless action that made the
 * original screen actively misleading); `null` means we could not tell, and
 * the non-destructive action is the right default there too.
 */
export function shouldOfferAutoStart(
  diagnostics: SetupDiagnostics | null,
): boolean {
  if (!diagnostics) return true
  return diagnostics.gatewayProcessRunning === false
}

export function describeMissingCapabilities(
  missing: Array<string>,
): string | null {
  if (missing.length === 0) return null
  const labels = missing.map((key) => CAPABILITY_LABELS[key] ?? key)
  const shown = labels.slice(0, 6)
  const rest = labels.length - shown.length
  return rest > 0 ? `${shown.join(', ')}, and ${rest} more` : shown.join(', ')
}

type Props = { onConnected: (status: AuthStatus) => void }

declare global {
  interface Window {
    __dismissSplash?: () => void
  }
}

export function ConnectionStartupScreen({ onConnected }: Props) {
  const [showFailureState, setShowFailureState] = useState(false)
  const [serverStarting, setServerStarting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [serverLog, setServerLog] = useState<Array<string>>([])
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [diagnostics, setDiagnostics] = useState<SetupDiagnostics | null>(null)
  const [rechecking, setRechecking] = useState(false)

  const platform = useRef<Platform>(detectPlatform())
  const steps = getSetupSteps(platform.current)

  const onConnectedRef = useRef(onConnected)
  useEffect(() => {
    onConnectedRef.current = onConnected
  }, [onConnected])

  const isDone = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const dismiss = window.__dismissSplash
    if (!dismiss) return
    const timer = setTimeout(() => dismiss(), 60)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    isDone.current = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let autoStartTimer: ReturnType<typeof setTimeout> | null = null
    let autoStartFired = false

    const failureTimer = setTimeout(() => {
      if (!isDone.current) {
        setShowFailureState(true)
      }
    }, FAILURE_REVEAL_MS)

    // Start the diagnosis immediately, in parallel with the first connect
    // attempt. Its answer gates the silent auto-start below, so it must be
    // in flight before that timer fires rather than started on reveal.
    const diagnosticsPromise = fetchDiagnostics()
    void diagnosticsPromise.then((result) => {
      if (isDone.current || !result) return
      setDiagnostics(result)
    })

    // After a short grace period, fire /api/start-claude once silently.
    // If hermes-agent is installed and just not running, this brings it back
    // up without making the user click anything. The polling loop will see it.
    //
    // Gated on the diagnosis: when a gateway process is ALREADY running (or we
    // could not establish that it isn't), starting another one cannot help and
    // muddies the picture — that was the original failure this screen had.
    const fireSilentAutoStart = async () => {
      if (autoStartFired) return
      // Waited on, not read from state: the timer can fire before the
      // diagnosis has landed, and starting a duplicate gateway because the
      // answer had not arrived yet is the same mistake, one race later.
      const diagnosis = await diagnosticsPromise
      if (isDone.current) return
      if (!shouldOfferAutoStart(diagnosis)) return
      autoStartFired = true
      try {
        const res = await fetch('/api/start-claude', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        const ct = res.headers.get('content-type') || ''
        if (!ct.includes('application/json')) return
        const data = (await res.json()) as { ok?: boolean; message?: string }
        if (res.ok && data.ok) {
          // surface a one-line note so users see what happened if they're
          // looking at the failure panel
          setServerLog([
            String(
              data.message ||
                'Auto-started Hermes Agent gateway — reconnecting…',
            ),
          ])
        }
      } catch {
        // silent: manual auto-start button stays available
      }
    }
    autoStartTimer = setTimeout(() => {
      void fireSilentAutoStart()
    }, AUTO_START_DELAY_MS)

    const tryConnect = async () => {
      try {
        const status = await fetchClaudeAuthStatus()
        if (isDone.current) return
        isDone.current = true
        clearTimeout(failureTimer)
        clearTimeout(autoStartTimer)
        if (pollTimer) clearTimeout(pollTimer)
        onConnectedRef.current(status)
      } catch {
        if (isDone.current) return
        pollTimer = setTimeout(tryConnect, POLL_INTERVAL_MS)
      }
    }

    void tryConnect()

    return () => {
      isDone.current = true
      if (pollTimer) clearTimeout(pollTimer)
      clearTimeout(autoStartTimer)
      clearTimeout(failureTimer)
    }
  }, [])

  useEffect(() => {
    if (copiedIdx === null) return
    const timer = setTimeout(() => setCopiedIdx(null), 2_000)
    return () => clearTimeout(timer)
  }, [copiedIdx])

  const handleCopy = async (text: string, idx: number) => {
    try {
      await writeTextToClipboard(text)
      setCopiedIdx(idx)
    } catch {
      /* clipboard not available */
    }
  }

  const handleAutoStart = async () => {
    setServerStarting(true)
    setServerError(null)
    setServerLog(['Looking for hermes-agent...'])
    try {
      const res = await fetch('/api/start-claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        const msg = `Unexpected response (${res.status})`
        setServerLog([`Error: ${msg}`])
        setServerError(msg)
        setServerStarting(false)
        return
      }

      const data = (await res.json()) as Record<string, unknown>
      if (res.ok && data.ok) {
        setServerLog([
          String(data.message || 'Started — waiting for connection...'),
        ])
        setServerStarting(false)
        return
      }

      const msg = String(data.error || 'Could not find hermes-agent')
      const hint = data.hint ? String(data.hint) : ''
      setServerLog([`Error: ${msg}`])
      if (hint) setServerLog((prev) => [...prev, `Hint: ${hint}`])
      setServerError(msg)
      setServerStarting(false)
      // Show manual steps when auto-start fails
      setShowManual(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setServerLog([`Failed: ${msg}`])
      setServerError(msg)
      setServerStarting(false)
      setShowManual(true)
    }
  }

  /**
   * The accurate action when something IS already running: re-probe the
   * gateway and re-run the diagnosis, rather than launching a duplicate.
   */
  const handleRecheck = async () => {
    setRechecking(true)
    setServerError(null)
    try {
      await fetch('/api/gateway-reprobe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => null)
      const next = await fetchDiagnostics()
      if (next) setDiagnostics(next)
    } finally {
      setRechecking(false)
    }
  }

  const showDiagnostics = shouldShowDiagnostics(diagnostics)
  const offerAutoStart = shouldOfferAutoStart(diagnostics)
  const problems = showDiagnostics
    ? [...diagnostics.findings]
        .filter((f) => f.severity !== 'ok')
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    : []
  const missingSummary = showDiagnostics
    ? describeMissingCapabilities(diagnostics.missingCapabilities)
    : null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto px-6 py-10 text-white"
      style={{
        backgroundColor: '#0A0E1A',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div className="flex w-full max-w-lg flex-col items-center text-center">
        <img
          src="/claude-avatar.webp"
          alt="Hermes Agent"
          className="mb-5 h-20 w-20 rounded-2xl object-cover shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
        />

        <h1 className="text-[2rem] font-semibold tracking-tight text-white">
          Hermes Switch UI
        </h1>

        {/* Connecting spinner */}
        <div
          className={[
            'mt-4 flex items-center gap-3 text-sm text-white/72 transition-opacity duration-300',
            showFailureState ? 'opacity-0 h-0' : 'opacity-100',
          ].join(' ')}
          aria-hidden={showFailureState}
        >
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
          <span>Connecting to your backend...</span>
        </div>

        {/* Failure state — setup guide */}
        <div
          className={[
            'w-full overflow-hidden transition-all duration-500 ease-out',
            showFailureState
              ? 'mt-6 max-h-[120rem] translate-y-0 opacity-100'
              : 'max-h-0 translate-y-2 opacity-0',
          ].join(' ')}
        >
          <div className="w-full rounded-3xl border border-white/10 bg-white/5 p-5 text-left shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-sm">
            {showDiagnostics ? (
              <>
                <p className="text-base font-medium text-white">
                  Your Hermes install is not serving this app
                </p>
                <p className="mt-2 text-sm leading-6 text-white/60">
                  {diagnostics.gatewayUrl
                    ? `This app talks to Hermes at ${diagnostics.gatewayUrl}. `
                    : ''}
                  Here is what it found, most important first.
                </p>

                {missingSummary ? (
                  <p
                    className="mt-3 text-xs leading-5 text-white/45"
                    data-testid="missing-capabilities"
                  >
                    Currently unavailable: {missingSummary}.
                  </p>
                ) : null}

                <ul
                  className="mt-4 space-y-3"
                  data-testid="diagnostic-findings"
                >
                  {problems.map((finding) => {
                    const style = SEVERITY_STYLES[finding.severity]
                    return (
                      <li
                        key={finding.id}
                        className={['rounded-xl border p-4', style.box].join(
                          ' ',
                        )}
                        data-severity={finding.severity}
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className={[
                              'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                              style.dot,
                            ].join(' ')}
                          />
                          <div className="min-w-0">
                            <p
                              className={[
                                'text-[0.7rem] font-semibold uppercase tracking-wide',
                                style.text,
                              ].join(' ')}
                            >
                              {style.label}
                            </p>
                            <p className="mt-1 text-sm font-medium leading-6 text-white/90">
                              {finding.title}
                            </p>
                            {finding.detail ? (
                              <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-white/55">
                                {finding.detail}
                              </p>
                            ) : null}
                            {finding.remedy ? (
                              <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-black/25 p-2.5 font-mono text-xs leading-5 text-white/70">
                                {finding.remedy}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </>
            ) : (
              <>
                <p className="text-base font-medium text-white">
                  Welcome! Let&apos;s connect your backend
                </p>
                <p className="mt-2 text-sm leading-6 text-white/60">
                  Hermes Switch UI works with any OpenAI-compatible backend.
                  Hermes Agent gateway APIs unlock enhanced features
                  automatically when they are available.
                </p>
              </>
            )}

            {/* Primary action — Auto-Start only when nothing is already running */}
            <div className="mt-5">
              {offerAutoStart ? (
                <button
                  type="button"
                  disabled={serverStarting}
                  onClick={handleAutoStart}
                  className={[
                    'w-full rounded-xl px-5 py-3 text-sm font-semibold transition',
                    serverStarting
                      ? 'cursor-not-allowed bg-indigo-900/70 text-indigo-200'
                      : 'bg-indigo-500 text-white hover:bg-indigo-400',
                  ].join(' ')}
                >
                  {serverStarting ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white/90" />
                      Detecting...
                    </span>
                  ) : (
                    'Auto-Start Hermes Agent Gateway'
                  )}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={rechecking}
                    onClick={handleRecheck}
                    className={[
                      'w-full rounded-xl px-5 py-3 text-sm font-semibold transition',
                      rechecking
                        ? 'cursor-not-allowed bg-indigo-900/70 text-indigo-200'
                        : 'bg-indigo-500 text-white hover:bg-indigo-400',
                    ].join(' ')}
                  >
                    {rechecking ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white/90" />
                        Re-checking...
                      </span>
                    ) : (
                      'Re-check connection'
                    )}
                  </button>
                  <p className="mt-2 text-xs leading-5 text-white/40">
                    {diagnostics?.gatewayProcessRunning === true
                      ? 'Hermes is already running, so starting it again would change nothing. Fix the problem above, restart it yourself, then re-check.'
                      : 'We could not confirm whether Hermes is already running, so this screen will not start a second copy. Fix anything listed above, then re-check.'}
                  </p>
                </>
              )}

              {/* Server log */}
              {serverLog.length > 0 ? (
                <div
                  className={[
                    'mt-3 rounded-xl border p-3',
                    serverError
                      ? 'border-red-500/20 bg-red-950/30'
                      : 'border-emerald-500/20 bg-emerald-950/30',
                  ].join(' ')}
                >
                  <pre className="whitespace-pre-wrap font-mono text-xs leading-5 text-white/70">
                    {serverLog.join('\n')}
                  </pre>
                </div>
              ) : null}
            </div>

            {/* Divider */}
            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/10" />
              <button
                type="button"
                onClick={() => setShowManual(!showManual)}
                className="text-xs font-medium text-white/50 transition hover:text-white/70"
              >
                {showManual ? 'Hide' : 'Show'} manual setup
              </button>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            {/* Manual setup steps */}
            <div
              className={[
                'overflow-hidden transition-all duration-300',
                showManual ? 'max-h-[40rem] opacity-100' : 'max-h-0 opacity-0',
              ].join(' ')}
            >
              <div className="space-y-4">
                {steps.map((step, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-white/8 bg-black/20 p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-bold text-indigo-300">
                          {idx + 1}
                        </span>
                        <span className="text-sm font-medium text-white/90">
                          {step.title}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(step.command, idx)}
                        className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/60 transition hover:bg-white/10 hover:text-white/80"
                      >
                        {copiedIdx === idx ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>
                    <pre className="mt-2 overflow-x-auto rounded-lg bg-black/40 p-3 font-mono text-xs leading-5 text-white/80">
                      <code>{step.command}</code>
                    </pre>
                    {step.note ? (
                      <p className="mt-2 text-xs text-white/40">{step.note}</p>
                    ) : null}
                  </div>
                ))}
              </div>

              {/* Env var hint */}
              <div className="mt-4 rounded-xl border border-white/6 bg-white/3 p-3">
                <p className="text-xs font-medium text-white/50">
                  Point{' '}
                  <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-white/70">
                    HERMES_API_URL
                  </code>{' '}
                  at any OpenAI-compatible backend:
                </p>
                <pre className="mt-2 overflow-x-auto font-mono text-xs text-white/60">
                  HERMES_API_URL=http://your-server:8642 pnpm dev
                </pre>
              </div>
            </div>
          </div>
        </div>

        {!showFailureState ? (
          <p className="mt-6 text-xs text-white/45">
            This page auto-refreshes when a compatible backend is detected
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** Fetch the diagnosis. Resolves to `null` on any failure — a screen that
 *  cannot diagnose falls back to the original welcome path rather than
 *  showing an error about the error. */
async function fetchDiagnostics(): Promise<SetupDiagnostics | null> {
  try {
    const res = await fetch('/api/setup-diagnostics')
    if (!res.ok) return null
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('application/json')) return null
    const body = (await res.json()) as Partial<SetupDiagnostics>
    if (!Array.isArray(body.findings)) return null
    return {
      severity: body.severity ?? 'unknown',
      gatewayProcessRunning:
        typeof body.gatewayProcessRunning === 'boolean'
          ? body.gatewayProcessRunning
          : null,
      missingCapabilities: Array.isArray(body.missingCapabilities)
        ? body.missingCapabilities
        : [],
      firstRun: body.firstRun === true,
      findings: body.findings,
      gatewayUrl: body.gatewayUrl,
    }
  } catch {
    return null
  }
}
