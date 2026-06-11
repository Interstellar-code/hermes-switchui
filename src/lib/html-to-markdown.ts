import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

let service: TurndownService | null = null

function getService(): TurndownService {
  if (service) return service
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    hr: '---',
  })
  // GFM plugin adds tables, strikethrough, and task-list support.
  td.use(gfm)
  service = td
  return td
}

/**
 * Convert pasted rich HTML into Markdown source.
 *
 * Used by the chat composer so that copying a formatted table / list / styled
 * text into the message box preserves its structure (as Markdown) instead of
 * collapsing to the browser's structureless plain-text fallback.
 *
 * Returns an empty string on any failure so callers can fall back to the
 * default plain-text paste.
 */
export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return ''
  try {
    return getService().turndown(html).trim()
  } catch {
    return ''
  }
}
