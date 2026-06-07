// Mock data for the isolated shadcn composer sandbox.
// All values are static fixtures — no stores, no network. Used only by the
// /composer-preview dev route to exercise the cherry-picked composer features.

export type MockModel = {
  id: string
  name: string
  provider: string
  reasoning?: boolean
  vision?: boolean
  contextWindow: number
}

export type MockSession = {
  id: string
  title: string
  kind: string
  channel: string
  project: string
  agentEmoji: string
  agentName: string
  agentRole: string
}

export type AutocompleteItem = {
  id: string
  label: string
  description?: string
}

export const MOCK_MODELS: MockModel[] = [
  {
    id: 'claude-opus-4',
    name: 'Claude Opus 4',
    provider: 'anthropic',
    reasoning: true,
    vision: true,
    contextWindow: 1_100_000,
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    vision: true,
    contextWindow: 200_000,
  },
  {
    id: 'gpt-5',
    name: 'GPT-5',
    provider: 'openai',
    reasoning: true,
    vision: true,
    contextWindow: 400_000,
  },
  {
    id: 'gpt-5-mini',
    name: 'GPT-5 Mini',
    provider: 'openai',
    contextWindow: 128_000,
  },
  {
    id: 'gemini-2-5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    reasoning: true,
    vision: true,
    contextWindow: 2_000_000,
  },
]

export const MOCK_SESSION: MockSession = {
  id: 'sess-mock-001',
  title: 'Sandbox composer preview',
  kind: 'chat',
  channel: 'local',
  project: 'hermes-switchui',
  agentEmoji: '🛰️',
  agentName: 'Hermes',
  agentRole: 'Engineer',
}

// Mock used / total context for the live counter (e.g. "38.0k / 1.1M").
export const MOCK_CONTEXT = {
  used: 38_000,
  total: 1_100_000,
}

export const MOCK_COMMANDS: AutocompleteItem[] = [
  { id: 'clear', label: '/clear', description: 'Clear the conversation' },
  { id: 'model', label: '/model', description: 'Switch the active model' },
  { id: 'help', label: '/help', description: 'Show available commands' },
  { id: 'compress', label: '/compress', description: 'Compress the context window' },
  { id: 'reset', label: '/reset', description: 'Reset the session state' },
  { id: 'export', label: '/export', description: 'Export the transcript' },
]

export const MOCK_MENTIONS: AutocompleteItem[] = [
  { id: 'hermes', label: '@hermes', description: 'Primary engineering agent' },
  { id: 'researcher', label: '@researcher', description: 'Deep research agent' },
  { id: 'reviewer', label: '@reviewer', description: 'Code review agent' },
  { id: 'planner', label: '@planner', description: 'Strategic planning agent' },
  { id: 'designer', label: '@designer', description: 'UI/UX design agent' },
]

// A mock "replying to" target for the reply-to feature.
export const MOCK_REPLY_TARGET = {
  seq: 42,
  role: 'assistant',
  preview: 'The token bridge forwards every shadcn var onto the active --theme-* palette.',
}
