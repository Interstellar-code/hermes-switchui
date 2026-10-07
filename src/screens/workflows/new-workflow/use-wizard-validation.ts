/**
 * Validation + id availability for the create wizard.
 *
 * Two paths, both always correct:
 *  - feature `validate` listed → debounced POST /definitions/validate for the
 *    draft's issues (no id: a taken id is an id-field problem, not a YAML
 *    error) plus a separate id-only call for `id_available`;
 *  - otherwise → client lint (`lintWorkflowYaml`) and an id check against the
 *    definitions list. Anything that needs the backend is simply absent.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
  /** The features query answered (until then `hasValidate` is not known). */
  featuresReady: boolean
  /** The features query failed: `hasValidate` stays unknown. */
  featuresFailed: boolean
  hasValidate: boolean
  hasCreateOnly: boolean
  lint: LintResult
  risky: Array<RiskyShell>
  /** Issues for exactly the current yaml; null while pending or unavailable. */
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
  /** Ids the engine 409'd on save; taken even while the list is missing. */
  conflictIds?: ReadonlySet<string>
}): WizardValidation {
  const { yaml, id, existingIds, conflictIds } = input
  const queryClient = useQueryClient()
  const features = useWorkflowFeatures()
  // Until the features answer, `create_only` is unknown and Save could go out
  // without `if_absent` — so the id counts as unconfirmed.
  const featuresReady = features.data != null && !features.isError
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
  const enabled = hasValidate && yaml.trim().length > 0
  const query = useQuery({
    queryKey: ['workflow-validate', debouncedYaml],
    queryFn: () => validateWorkflowDefinition(debouncedYaml, undefined),
    enabled,
    retry: false,
    staleTime: 10_000,
  })
  const settled = debouncedYaml === yaml
  const server = enabled && settled ? (query.data ?? null) : null
  const serverPending = enabled && (!settled || query.isFetching)
  // `id_available` does not depend on the yaml (the engine only looks the id
  // up), so this call sends none and re-runs on id changes only.
  const idQuery = useQuery({
    queryKey: ['workflow-validate-id', debouncedId],
    queryFn: () => validateWorkflowDefinition('', debouncedId),
    enabled: hasValidate && idOk && debouncedId === id,
    retry: false,
    staleTime: 10_000,
  })
  const idAvailable =
    debouncedId === id ? (idQuery.data?.id_available ?? null) : null
  const idPending =
    hasValidate && idOk && (debouncedId !== id || idQuery.isFetching)
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
        line: w.line ?? null,
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
  else if (existingIds?.has(id) || conflictIds?.has(id)) idStatus = 'taken'
  else if (!featuresReady) idStatus = 'unknown'
  else if (idPending) idStatus = 'checking'
  else if (hasValidate && idAvailable === true) idStatus = 'available'
  else if (hasValidate && idAvailable === false) idStatus = 'taken'
  else if (existingIds) idStatus = 'available'
  else idStatus = 'unknown'

  const refetchServerRef = useRef<() => Promise<unknown>>(query.refetch)
  // A plain refetch would join a hung first load; cancel it, then ask again.
  refetchServerRef.current = !featuresReady
    ? () =>
        queryClient
          .cancelQueries({ queryKey: ['workflow-features'] })
          .then(() => features.refetch())
    : hasValidate
      ? () => Promise.all([query.refetch(), idQuery.refetch()])
      : () => Promise.resolve()

  return {
    featuresReady,
    featuresFailed: features.isError,
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

/** What DESIGN / CONFIGURE show and gate on: engine issues for the current yaml. */
export type WizardIssueState =
  | { kind: 'pending' }
  | { kind: 'unavailable'; reason: string }
  | {
      kind: 'ready'
      errors: WorkflowValidationResult['errors']
      warnings: WorkflowValidationResult['warnings']
    }

export function wizardIssueState(v: WizardValidation): WizardIssueState {
  if (v.featuresFailed)
    return { kind: 'unavailable', reason: 'engine features unreachable' }
  // Unknown until the features answer; stepping stays possible meanwhile
  // (REVIEW keeps Save blocked on the same unknown).
  if (!v.featuresReady)
    return { kind: 'unavailable', reason: 'engine features not known yet' }
  if (!v.hasValidate)
    return { kind: 'unavailable', reason: 'this engine has no validate' }
  if (v.engineDown) return { kind: 'unavailable', reason: 'engine down' }
  if (v.serverFailed)
    return { kind: 'unavailable', reason: 'the validate call failed' }
  if (v.server)
    return {
      kind: 'ready',
      errors: v.server.errors,
      warnings: v.server.warnings,
    }
  if (v.serverPending) return { kind: 'pending' }
  return { kind: 'unavailable', reason: 'empty draft' }
}

/** Next on DESIGN / CONFIGURE: blocked while pending or with errors. */
export function issuesBlockNext(s: WizardIssueState): boolean {
  return s.kind === 'pending' || (s.kind === 'ready' && s.errors.length > 0)
}
