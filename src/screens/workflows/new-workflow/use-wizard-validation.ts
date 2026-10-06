/**
 * Validation + id availability for the create wizard.
 *
 * Two paths, both always correct:
 *  - feature `validate` listed → debounced POST /definitions/validate drives
 *    id availability and extra server checks;
 *  - otherwise → client lint (`lintWorkflowYaml`) and an id check against the
 *    definitions list. Anything that needs the backend is simply absent.
 */
import { useEffect, useMemo, useState } from 'react'
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
  lint: LintResult
  risky: Array<RiskyShell>
  server: WorkflowValidationResult | null
  serverPending: boolean
  idStatus: IdStatus
  /** The backend (validate call) reported the engine as unavailable. */
  engineDown: boolean
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
  const lint = useMemo(() => lintWorkflowYaml(yaml), [yaml])
  const risky = useMemo(() => findRiskyShell(yaml), [yaml])
  const idOk = ID_REGEX.test(id)

  const debounced = useDebounced({ yaml, id }, 200)
  const settled = debounced.yaml === yaml && debounced.id === id
  const enabled = hasValidate && yaml.trim().length > 0
  const query = useQuery({
    queryKey: ['workflow-validate', debounced.yaml, debounced.id],
    queryFn: () =>
      validateWorkflowDefinition(debounced.yaml, debounced.id || undefined),
    enabled,
    retry: false,
    staleTime: 10_000,
  })
  const server = enabled && settled ? (query.data ?? null) : null
  const serverPending = enabled && (!settled || query.isFetching)
  const engineDown = query.error instanceof WorkflowEngineUnavailableError

  let idStatus: IdStatus
  if (!id) idStatus = 'empty'
  else if (!idOk) idStatus = 'invalid'
  else if (existingIds?.has(id)) idStatus = 'taken'
  else if (hasValidate && serverPending) idStatus = 'checking'
  else if (hasValidate && server?.id_available === true) idStatus = 'available'
  else if (hasValidate && server?.id_available === false) idStatus = 'taken'
  else if (existingIds) idStatus = 'available'
  else idStatus = 'unknown'

  return {
    hasValidate,
    lint,
    risky,
    server,
    serverPending,
    idStatus,
    engineDown,
  }
}
