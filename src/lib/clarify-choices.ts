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
    const label = Object.keys(choice).find(
      (key) => key !== 'value' && key.trim().length > 0,
    )
    if (label) return [label.trim()]
    const choiceValue = (choice as Record<string, unknown>).value
    if (typeof choiceValue === 'string' && choiceValue.trim()) {
      return [choiceValue.trim().replace(/[_-]+/g, ' ')]
    }
    return []
  })
  return choices.length ? choices : null
}
