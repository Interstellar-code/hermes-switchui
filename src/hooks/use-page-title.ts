import { useEffect } from 'react'

const BASE_TITLE = 'Hermes Switch UI'

/**
 * Sets document.title for the current page.
 * Usage: usePageTitle('Sessions') → "Sessions — Hermes Switch UI"
 */
export function usePageTitle(page: string) {
  useEffect(() => {
    document.title = page ? `${page} — ${BASE_TITLE}` : BASE_TITLE
    return () => {
      document.title = BASE_TITLE
    }
  }, [page])
}
