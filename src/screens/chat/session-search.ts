import type { SessionFeedItem } from './sessions-feed-types'

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function fuzzyIncludes(haystack: string, needle: string): boolean {
  if (!needle) return true
  let needleIndex = 0
  for (const char of haystack) {
    if (char === needle[needleIndex]) needleIndex += 1
    if (needleIndex === needle.length) return true
  }
  return false
}

function getSearchValues(item: SessionFeedItem): Array<string> {
  const values = [item.id, item.title, item.sub ?? '']
  for (const badge of item.badges) values.push(badge.text)
  for (const value of Object.values(item.sourceMeta)) {
    if (typeof value === 'string') values.push(value)
    else if (typeof value === 'number' || typeof value === 'boolean') {
      values.push(String(value))
    }
  }
  return values
}

export function matchesSessionSearch(item: SessionFeedItem, query: string): boolean {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  if (terms.length === 0) return true

  const values = getSearchValues(item).map((value) => ({
    raw: value.toLowerCase(),
    normalized: normalizeSearchText(value),
  }))

  return terms.every((term) => {
    const normalizedTerm = normalizeSearchText(term)
    if (!normalizedTerm) return true

    return values.some(({ raw, normalized }) => {
      if (raw.includes(term)) return true
      if (normalized.includes(normalizedTerm)) return true
      return normalizedTerm.length >= 3 && fuzzyIncludes(normalized, normalizedTerm)
    })
  })
}
