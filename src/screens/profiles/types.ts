import type { McpServerConfig, MemoryProvider } from '@/server/profiles-browser'

// ── Wizard draft state ────────────────────────────────────────────────────────

export type NewAgentDraft = {
  // Step 1 — Identity
  name: string
  glyph: string
  role: string
  tags: string[]

  // Step 2 — Persona
  persona_id: string | null
  system_prompt: string

  // Step 3 — Model
  model: string
  provider: string
  max_turns: number
  reasoning_effort: 'low' | 'medium' | 'high'

  // Step 4 — Skills
  skill_dirs: string[]

  // Step 5 — MCP
  mcp_servers: Record<string, McpServerConfig>

  // Step 6 — Memory
  memory_enabled: boolean
  memory_provider: MemoryProvider
}

export const INITIAL_DRAFT: NewAgentDraft = {
  name: '',
  glyph: '',
  role: '',
  tags: [],
  persona_id: null,
  system_prompt: '',
  model: '',
  provider: '',
  max_turns: 200,
  reasoning_effort: 'medium',
  skill_dirs: [],
  mcp_servers: {},
  memory_enabled: false,
  memory_provider: 'hindsight',
}

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7

export type WizardState = {
  draft: NewAgentDraft
  step: WizardStep
  errors: Record<number, string[]>
  submitting: boolean
  submitError: string | null
}

export type WizardAction =
  | { type: 'SET_DRAFT'; patch: Partial<NewAgentDraft> }
  | { type: 'SET_STEP'; step: WizardStep }
  | { type: 'SET_ERRORS'; step: number; errors: string[] }
  | { type: 'CLEAR_ERRORS'; step: number }
  | { type: 'SET_SUBMITTING'; value: boolean }
  | { type: 'SET_SUBMIT_ERROR'; error: string | null }
  | { type: 'RESET' }

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_DRAFT':
      return { ...state, draft: { ...state.draft, ...action.patch } }
    case 'SET_STEP':
      return { ...state, step: action.step }
    case 'SET_ERRORS':
      return { ...state, errors: { ...state.errors, [action.step]: action.errors } }
    case 'CLEAR_ERRORS':
      return { ...state, errors: { ...state.errors, [action.step]: [] } }
    case 'SET_SUBMITTING':
      return { ...state, submitting: action.value }
    case 'SET_SUBMIT_ERROR':
      return { ...state, submitError: action.error }
    case 'RESET':
      return { draft: { ...INITIAL_DRAFT }, step: 1, errors: {}, submitting: false, submitError: null }
    default:
      return state
  }
}

export const INITIAL_WIZARD_STATE: WizardState = {
  draft: { ...INITIAL_DRAFT },
  step: 1,
  errors: {},
  submitting: false,
  submitError: null,
}

// ── Step labels ───────────────────────────────────────────────────────────────

export const STEP_LABELS: Record<WizardStep, string> = {
  1: 'Identity',
  2: 'Persona',
  3: 'Model',
  4: 'Skills',
  5: 'MCP',
  6: 'Memory',
  7: 'Review',
}

// ── Validation ────────────────────────────────────────────────────────────────

const NAME_RE = /^[a-z0-9-]{2,40}$/
const GLYPH_RE = /^[A-Z0-9]{1,3}$/

export function validateStep(
  step: WizardStep,
  draft: NewAgentDraft,
  existingNames: string[],
): string[] {
  const errs: string[] = []
  if (step === 1) {
    if (!NAME_RE.test(draft.name)) {
      errs.push('Name must be 2–40 lowercase letters, numbers, or hyphens')
    } else if (existingNames.includes(draft.name)) {
      errs.push(`Name "${draft.name}" is already in use`)
    }
    if (!GLYPH_RE.test(draft.glyph)) {
      errs.push('Glyph must be 1–3 uppercase letters or digits')
    }
    if (!draft.role.trim()) {
      errs.push('Role is required')
    } else if (draft.role.length > 80) {
      errs.push('Role must be ≤80 characters')
    }
  } else if (step === 2) {
    if (!draft.persona_id) {
      errs.push('Please select a persona')
    }
    if (!draft.system_prompt?.trim()) {
      errs.push('System prompt is required')
    }
  } else if (step === 3) {
    if (!draft.model) errs.push('Model is required')
    if (!draft.provider) errs.push('Provider is required')
  }
  // Steps 4, 5 are optional
  // Step 6: memory_provider required only if memory_enabled
  else if (step === 6) {
    if (draft.memory_enabled && !draft.memory_provider) {
      errs.push('Memory provider is required when memory is enabled')
    }
  }
  // Step 7: validate all prior steps
  else if (step === 7) {
    const prior = [1, 2, 3, 6] as const
    for (const s of prior) {
      const e = validateStep(s as WizardStep, draft, existingNames)
      errs.push(...e)
    }
  }
  return errs
}

export function isDraftDirty(draft: NewAgentDraft): boolean {
  return (
    draft.name !== '' ||
    draft.glyph !== '' ||
    draft.role !== '' ||
    draft.tags.length > 0 ||
    draft.persona_id !== null ||
    draft.system_prompt !== '' ||
    draft.model !== '' ||
    draft.provider !== '' ||
    draft.max_turns !== INITIAL_DRAFT.max_turns ||
    draft.reasoning_effort !== INITIAL_DRAFT.reasoning_effort ||
    draft.skill_dirs.length > 0 ||
    Object.keys(draft.mcp_servers).length > 0 ||
    draft.memory_enabled
  )
}
