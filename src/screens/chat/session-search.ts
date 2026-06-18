import type { SessionFeedItem } from './sessions-feed-types'

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function getSearchValues(item: SessionFeedItem): {
  primary: Array<string>
  secondary: Array<string>
} {
  const primary = [item.id, item.title, item.sub ?? '']
  const secondary: Array<string> = []
  for (const badge of item.badges) primary.push(badge.text)
  for (const value of Object.values(item.sourceMeta)) {
    if (typeof value === 'string') secondary.push(value)
    else if (typeof value === 'number' || typeof value === 'boolean') {
      secondary.push(String(value))
    }
  }
  return { primary, secondary }
}

function matchesText(value: string, term: string): boolean {
  const raw = value.toLowerCase()
  const normalized = normalizeSearchText(value)
  const normalizedTerm = normalizeSearchText(term)
  if (!normalizedTerm) return true
  return (
    raw === term ||
    raw.startsWith(term) ||
    raw.includes(term) ||
    normalized === normalizedTerm ||
    normalized.startsWith(normalizedTerm) ||
    normalized.includes(normalizedTerm)
  )
}

export function matchesSessionSearch(item: SessionFeedItem, query: string): boolean {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  if (terms.length === 0) return true

  const { primary, secondary } = getSearchValues(item)
  return terms.every((term) => {
    if (primary.some((value) => matchesText(value, term))) return true
    return secondary.some((value) => matchesText(value, term) && value.toLowerCase().includes(term))
  })
}
