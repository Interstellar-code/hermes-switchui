export type HermesKanbanBlockCode =
  | 'dependency'
  | 'review'
  | 'environment'
  | 'access'
  | 'external'
  | 'agent'
  | 'other'

export const HERMES_KANBAN_BLOCK_REASON_OPTIONS: Array<{
  value: HermesKanbanBlockCode
  label: string
}> = [
  { value: 'dependency', label: 'Dependency' },
  { value: 'review', label: 'Review' },
  { value: 'environment', label: 'Environment' },
  { value: 'access', label: 'Access / permissions' },
  { value: 'external', label: 'External wait' },
  { value: 'agent', label: 'Agent / runtime failure' },
  { value: 'other', label: 'Other / legacy' },
]

const BLOCK_CODE_SET = new Set<string>(
  HERMES_KANBAN_BLOCK_REASON_OPTIONS.map((option) => option.value),
)

export type ParsedKanbanBlockReason = {
  code: HermesKanbanBlockCode
  detail: string
  legacy: boolean
}

export function parseKanbanBlockReason(raw: string | null | undefined): ParsedKanbanBlockReason {
  const value = raw?.trim() ?? ''
  if (!value) return { code: 'other', detail: '', legacy: false }

  const match = value.match(/^\[([a-z]+)\]\s*(.*)$/i)
  const code = match?.[1]?.toLowerCase() ?? ''
  if (code && BLOCK_CODE_SET.has(code)) {
    return {
      code: code as HermesKanbanBlockCode,
      detail: match?.[2]?.trim() ?? '',
      legacy: false,
    }
  }

  return { code: 'other', detail: value, legacy: true }
}

export function formatKanbanBlockReason(
  code: HermesKanbanBlockCode,
  detail: string,
): string | null {
  const trimmed = detail.trim()
  if (code === 'other') return trimmed || null
  return trimmed ? `[${code}] ${trimmed}` : `[${code}]`
}
