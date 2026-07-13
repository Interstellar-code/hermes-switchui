const CHOICE_LABEL_KEYS = ['label', 'content', 'description', 'text', 'title'] as const

export function normalizeClarifyChoices(value: unknown): Array<string> | null {
  if (!Array.isArray(value)) return null
  const choices = value.flatMap((choice) => {
    if (typeof choice === 'string') return choice.trim() ? [choice.trim()] : []
    if (!choice || typeof choice !== 'object') return []
    for (const key of CHOICE_LABEL_KEYS) {
      const label = (choice as Record<string, unknown>)[key]
      if (typeof label === 'string' && label.trim()) return [label.trim()]
    }
    return []
  })
  return choices.length ? choices : null
}
