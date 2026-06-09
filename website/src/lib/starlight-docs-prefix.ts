import type {
  SidebarEntry,
  SidebarLink,
  StarlightRouteData,
} from '../../node_modules/@astrojs/starlight/utils/routing/types'

const DOCS_PREFIX = '/docs'

function prefixHref(href: string): string {
  if (/^(https?:|mailto:|#)/i.test(href)) return href
  if (href === '/') return `${DOCS_PREFIX}/`
  return `${DOCS_PREFIX}${href}`.replace(/\/+/g, '/').replace(/(?<!:)\/\//g, '/')
}

function prefixSidebarEntry(entry: SidebarEntry): SidebarEntry {
  if (entry.type === 'group') {
    return {
      ...entry,
      entries: entry.entries.map(prefixSidebarEntry),
    }
  }
  return {
    ...entry,
    href: prefixHref(entry.href),
  }
}

function markCurrent(entries: SidebarEntry[], pathname: string): boolean {
  for (const entry of entries) {
    if (entry.type === 'group') {
      if (markCurrent(entry.entries, pathname)) return true
      continue
    }
    entry.isCurrent = entry.href.replace(/\/$/, '') === pathname.replace(/\/$/, '')
    if (entry.isCurrent) return true
  }
  return false
}

function flatten(entries: SidebarEntry[]): SidebarLink[] {
  const flat: SidebarLink[] = []
  for (const entry of entries) {
    if (entry.type === 'group') flat.push(...flatten(entry.entries))
    else flat.push(entry)
  }
  return flat
}

export function prefixRouteData(routeData: StarlightRouteData, pathname: string): StarlightRouteData {
  const sidebar = routeData.sidebar.map(prefixSidebarEntry)
  markCurrent(sidebar, pathname)
  const flat = flatten(sidebar)
  const currentIndex = flat.findIndex((entry) => entry.isCurrent)
  const prev = currentIndex > 0 ? { ...flat[currentIndex - 1] } : undefined
  const next = currentIndex > -1 && currentIndex < flat.length - 1 ? { ...flat[currentIndex + 1] } : undefined

  return {
    ...routeData,
    siteTitleHref: `${DOCS_PREFIX}/`,
    sidebar,
    pagination: {
      prev,
      next,
    },
  }
}
