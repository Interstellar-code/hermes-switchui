/**
 * Wikilink helpers for the Wiki tab. Resolution happens server-side
 * (`/api/knowledge/read` returns `links: { [key]: path | null }`); this file
 * only turns `[[target]]` / `[[target|label]]` into markdown links whose href
 * carries the lookup key, so react-markdown can render them.
 */

export const WIKILINK_HREF = '#wiki/'

/** Lookup key for a wikilink body — mirrors cleanWikilinkTarget in knowledge-browser.ts. */
export function wikilinkKey(inner: string): string {
  return inner.split('|')[0]?.split('#')[0]?.trim() || ''
}

// encodeURIComponent leaves ( ) unescaped; they would end the markdown link href.
const encodeHref = (key: string) =>
  encodeURIComponent(key).replace(/\(/g, '%28').replace(/\)/g, '%29')

/** Rewrite wikilinks to `[label](#wiki/<key>)`, leaving code spans/fences untouched. */
export function wikilinksToMarkdown(md: string): string {
  return md
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/\[\[([^\]]+)\]\]/g, (whole, inner: string) => {
            const key = wikilinkKey(inner)
            if (!key) return whole
            const bar = inner.indexOf('|')
            const label = (bar >= 0 ? inner.slice(bar + 1).trim() : '') || key
            const safeLabel = label.replace(/[[\]\\]/g, '\\$&')
            return `[${safeLabel}](${WIKILINK_HREF}${encodeHref(key)})`
          }),
    )
    .join('')
}

/** `#wiki/<key>` href → key; null for any other href or a malformed escape. */
export function wikilinkKeyFromHref(href: string | undefined): string | null {
  if (!href?.startsWith(WIKILINK_HREF)) return null
  try {
    return decodeURIComponent(href.slice(WIKILINK_HREF.length))
  } catch {
    return null
  }
}

/**
 * A relative markdown link (`../x.md`, `y.md#sec`) inside page `currentPath` →
 * the wiki path it points at plus its #fragment. Null for absolute/scheme
 * URLs, bare `#anchors`, and non-.md targets.
 */
export function resolveRelativeWikiHref(
  href: string | undefined,
  currentPath: string,
): { path: string; hash: string } | null {
  if (!href || href.startsWith('#') || href.startsWith('/')) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null
  let url: URL
  try {
    url = new URL(href, `http://wiki.invalid/${currentPath}`)
  } catch {
    return null
  }
  let target: string
  try {
    target = decodeURIComponent(url.pathname.slice(1))
  } catch {
    return null
  }
  if (!target.toLowerCase().endsWith('.md')) return null
  return { path: target, hash: url.hash.slice(1) }
}

/** Own-property lookup: a page linking [[constructor]] must not hit Object.prototype. */
export function lookupWikilink(
  links: Record<string, string | null>,
  key: string,
): string | null {
  return Object.hasOwn(links, key) ? (links[key] ?? null) : null
}
