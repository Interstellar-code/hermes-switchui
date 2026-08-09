'use client'

/**
 * use-agent-cwd.ts — the wizard's binding to `/api/agent-cwd`.
 *
 * Deliberately thin. Everything interesting about the agent's working
 * directory — the sentinel ladder, the multiplex caveat, the profile
 * inheritance gap, the validation rules — lives in `src/server/agent-cwd.ts`
 * and is exercised by that module's own table-driven tests. Reimplementing any
 * of it here would give the wizard a second opinion, and the two would drift.
 *
 * The one behaviour this hook does own is the **dry-run then confirm** shape,
 * because writing `terminal.cwd` is the only control in Switch UI that changes
 * where commands actually execute. `preview()` POSTs `dryRun: true` and gets
 * back the before → after the endpoint would produce; `apply()` writes and
 * reports `needsGatewayRestart`. Nothing is written by `preview()`, which is
 * what lets the step show both directories before anything is persisted.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export type ResolvedCwdView = {
  path: string | null
  source: 'explicit-config' | 'home-sentinel' | 'container-default' | 'unknown'
  backend: string
  profile: string
  warnings: Array<string>
}

export type AgentCwdStatusView = {
  resolved: ResolvedCwdView
  activeProfile: string
  configuredCwd: string
  hasTerminalBlock: boolean
  /** False when editing this profile would have no effect (multiplex). */
  editable: boolean
  suggestedCwd: string | null
  homeDir: string
}

export type AgentCwdPreview = {
  before: ResolvedCwdView
  after: ResolvedCwdView
  path: string
}

export type UseAgentCwdResult = {
  status: AgentCwdStatusView | null
  loading: boolean
  error: string | null
  refetch: () => void
  preview: AgentCwdPreview | null
  previewing: boolean
  requestPreview: (path: string) => Promise<void>
  clearPreview: () => void
  applying: boolean
  /** Resolves true when the write landed. */
  apply: (path: string) => Promise<boolean>
  applied: { path: string; needsGatewayRestart: boolean } | null
}

const EMPTY_RESOLVED: ResolvedCwdView = {
  path: null,
  source: 'unknown',
  backend: 'local',
  profile: 'default',
  warnings: [],
}

function readResolved(value: unknown): ResolvedCwdView {
  if (!value || typeof value !== 'object') return EMPTY_RESOLVED
  const rec = value as Record<string, unknown>
  return {
    path: typeof rec.path === 'string' ? rec.path : null,
    source: (typeof rec.source === 'string'
      ? rec.source
      : 'unknown') as ResolvedCwdView['source'],
    backend: typeof rec.backend === 'string' ? rec.backend : 'local',
    profile: typeof rec.profile === 'string' ? rec.profile : 'default',
    warnings: Array.isArray(rec.warnings)
      ? rec.warnings.filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : [],
  }
}

async function postCwd(body: unknown, signal: AbortSignal) {
  const res = await fetch('/api/agent-cwd', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await res.json().catch(() => ({}))) as Record<
    string,
    unknown
  >
  return { res, payload }
}

export function useAgentCwd(input: {
  enabled: boolean
  /** A locked relaunch reads but never writes. */
  canWrite: boolean
}): UseAgentCwdResult {
  const { enabled, canWrite } = input
  const [status, setStatus] = useState<AgentCwdStatusView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<AgentCwdPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<{
    path: string
    needsGatewayRestart: boolean
  } | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  const load = useCallback(() => {
    if (!enabled) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    void fetch('/api/agent-cwd', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: unknown) => {
        if (controller.signal.aborted || !mountedRef.current) return
        if (!payload || typeof payload !== 'object') {
          setStatus(null)
          setError(
            'The workspace could not resolve the agent working directory.',
          )
          return
        }
        const rec = payload as Record<string, unknown>
        if (rec.ok === false) {
          setStatus(null)
          setError(typeof rec.error === 'string' ? rec.error : 'Unknown error')
          return
        }
        setError(null)
        setStatus({
          resolved: readResolved(rec.resolved),
          activeProfile:
            typeof rec.activeProfile === 'string'
              ? rec.activeProfile
              : 'default',
          configuredCwd:
            typeof rec.configuredCwd === 'string' ? rec.configuredCwd : '',
          hasTerminalBlock: rec.hasTerminalBlock === true,
          editable: rec.editable !== false,
          suggestedCwd:
            typeof rec.suggestedCwd === 'string' ? rec.suggestedCwd : null,
          homeDir: typeof rec.homeDir === 'string' ? rec.homeDir : '',
        })
      })
      .catch(() => {
        if (controller.signal.aborted || !mountedRef.current) return
        setError('The workspace could not be reached.')
      })
      .finally(() => {
        if (controller.signal.aborted || !mountedRef.current) return
        setLoading(false)
      })
  }, [enabled])

  useEffect(() => {
    mountedRef.current = true
    load()
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [load])

  const clearPreview = useCallback(() => {
    setPreview(null)
    setError(null)
  }, [])

  const requestPreview = useCallback(async (path: string) => {
    const trimmed = path.trim()
    if (!trimmed) return
    const controller = new AbortController()
    setPreviewing(true)
    setError(null)
    try {
      const { res, payload } = await postCwd(
        { path: trimmed, dryRun: true },
        controller.signal,
      )
      if (!mountedRef.current) return
      if (!res.ok || payload.ok === false) {
        setPreview(null)
        setError(
          typeof payload.error === 'string'
            ? payload.error
            : `The workspace refused that path (HTTP ${res.status}).`,
        )
        return
      }
      setPreview({
        before: readResolved(payload.before),
        after: readResolved(payload.after),
        path: trimmed,
      })
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Preview failed')
      }
    } finally {
      if (mountedRef.current) setPreviewing(false)
    }
  }, [])

  const apply = useCallback(
    async (path: string): Promise<boolean> => {
      // Refused before any request leaves, so a read-only run leaves no trace
      // on the network at all — the same rule `useOnboardingSave` follows.
      if (!canWrite) {
        setError(
          'Changes are locked for this run — nothing has been written to config.yaml.',
        )
        return false
      }
      const trimmed = path.trim()
      if (!trimmed) return false
      const controller = new AbortController()
      setApplying(true)
      setError(null)
      try {
        const { res, payload } = await postCwd(
          { path: trimmed, dryRun: false },
          controller.signal,
        )
        if (!res.ok || payload.ok === false) {
          if (mountedRef.current) {
            setError(
              typeof payload.error === 'string'
                ? payload.error
                : `The write failed (HTTP ${res.status}).`,
            )
          }
          return false
        }
        if (mountedRef.current) {
          setApplied({
            path:
              typeof payload.written === 'string' ? payload.written : trimmed,
            needsGatewayRestart: payload.needsGatewayRestart === true,
          })
          setPreview(null)
        }
        load()
        return true
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : 'The write failed')
        }
        return false
      } finally {
        if (mountedRef.current) setApplying(false)
      }
    },
    [canWrite, load],
  )

  return {
    status,
    loading,
    error,
    refetch: load,
    preview,
    previewing,
    requestPreview,
    clearPreview,
    applying,
    apply,
    applied,
  }
}
