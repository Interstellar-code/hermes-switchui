/**
 * Validation + id availability for the create wizard.
 *
 * Two paths, both always correct:
 *  - feature `validate` listed → debounced POST /definitions/validate drives
 *    id availability and extra server checks;
 *  - otherwise → client lint (`lintWorkflowYaml`) and an id check against the
 *    definitions list. Anything that needs the backend is simply absent.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkflowFeatures } from '../use-workflows'
import {
  WorkflowEngineUnavailableError,
  validateWorkflowDefinition,
} from '../api-client'
import { findRiskyShell, lintWorkflowYaml } from './yaml-lint'
import type { LintResult, RiskyShell } from './yaml-lint'
import type { WorkflowValidationResult } from '../api-client'

export const ID_REGEX = /^[A-Za-z0-9_:.-]{1,128}$/

export type IdStatus =
  | 'empty'
  | 'invalid'
  | 'checking'
  | 'available'
  | 'taken'
  | 'unknown'

export interface WizardValidation {
  hasValidate: boolean
  hasCreateOnly: boolean
  lint: LintResult
  risky: Array<RiskyShell>
  server: WorkflowValidationResult | null
  serverPending: boolean
  /** The validate call itself failed (404/500/…) — degrade to local checks, visibly. */
  serverFailed: boolean
  /** The backend (validate call) reported the engine as unavailable. */
  engineDown: boolean
  idStatus: IdStatus
  refetchServer: () => void
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function useWizardValidation(input: {
  yaml: string
  id: string
  /** Ids of existing definitions; null while the list is loading / failed. */
  existingIds: ReadonlySet<string> | null
}): WizardValidation {
  const { yaml, id, existingIds } = input
  const features = useWorkflowFeatures()
  const hasValidate =
    Array.isArray(features.data?.features) &&
    features.data.features.includes('validate')
  const hasCreateOnly =
    Array.isArray(features.data?.features) &&
    features.data.features.includes('create_only')
  const lint = useMemo(() => lintWorkflowYaml(yaml), [yaml])
  const clientRisky = useMemo(() => findRiskyShell(yaml), [yaml])
  const idOk = ID_REGEX.test(id)

  // Debounce the strings, not an object: a fresh object per render would
  // re-fire the effect below every render and loop setState forever.
  const debouncedYaml = useDebounced(yaml, 200)
  const debouncedId = useDebounced(id, 200)
  const settled = debouncedYaml === yaml && debouncedId === id
  const enabled = hasValidate && yaml.trim().length > 0
  const query = useQuery({
    queryKey: ['workflow-validate', debouncedYaml, debouncedId],
    queryFn: () =>
      validateWorkflowDefinition(debouncedYaml, debouncedId || undefined),
    enabled,
    retry: false,
    staleTime: 10_000,
  })
  const server = enabled && settled ? (query.data ?? null) : null
  const serverPending = enabled && (!settled || query.isFetching)
  const engineDown = query.error instanceof WorkflowEngineUnavailableError
  const serverFailed = query.error != null && !engineDown

  // The acknowledge gate covers every risky shell the user will really run:
  // the client scan (bash/script/loop.until_bash) plus the server's
  // risky_shell warnings, deduped by node and line.
  const risky = useMemo(() => {
    const serverRisky = (server?.warnings ?? [])
      .filter((w) => w.code === 'risky_shell')
      .map((w) => ({
        node_id: w.node_id ?? '?',
        line: w.line ?? 0,
        reason: w.message,
        snippet: '',
      }))
    const seen = new Set(clientRisky.map((r) => `${r.node_id}:${r.line}`))
    return [
      ...clientRisky,
      ...serverRisky.filter((r) => !seen.has(`${r.node_id}:${r.line}`)),
    ]
  }, [clientRisky, server])

  let idStatus: IdStatus
  if (!id) idStatus = 'empty'
  else if (!idOk) idStatus = 'invalid'
  else if (existingIds?.has(id)) idStatus = 'taken'
  else if (hasValidate && serverPending) idStatus = 'checking'
  else if (hasValidate && server?.id_available === true) idStatus = 'available'
  else if (hasValidate && server?.id_available === false) idStatus = 'taken'
  else if (existingIds) idStatus = 'available'
  else idStatus = 'unknown'

  const refetchServerRef = useRef(query.refetch)
  refetchServerRef.current = query.refetch

  return {
    hasValidate,
    hasCreateOnly,
    lint,
    risky,
    server,
    serverPending,
    serverFailed,
    engineDown,
    idStatus,
    refetchServer: () => void refetchServerRef.current(),
  }
}
