import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { parse as parseYaml } from 'yaml'

export type DocPage = {
  slug: string
  title: string
  description: string
  content: string
  order: number
  folder: string | null
}

export type DocFolder = {
  name: string
  pages: Array<{ slug: string; title: string }>
}

export type DocsTree = {
  rootPages: Array<{ slug: string; title: string }>
  folders: Array<DocFolder>
}

type ManifestEntry = {
  slug: string
  title?: string
}

type DocsManifest = {
  pages: Array<ManifestEntry>
}

const DEFAULT_DOCS_DIR = path.join(process.cwd(), 'docs')
const DEFAULT_MANIFEST_PATH = path.join(DEFAULT_DOCS_DIR, 'docs-manifest.yaml')

// Cache: keyed by path+mtime so manifest edits invalidate without restart.
let _manifestCache: DocsManifest | null = null
let _manifestPathCached: string | null = null
let _manifestMtimeCached: number | null = null

export function loadDocsManifest(
  manifestPath: string = DEFAULT_MANIFEST_PATH,
): DocsManifest {
  const mtime = fs.statSync(manifestPath).mtimeMs
  if (
    _manifestCache &&
    _manifestPathCached === manifestPath &&
    _manifestMtimeCached === mtime
  ) {
    return _manifestCache
  }
  const raw = fs.readFileSync(manifestPath, 'utf-8')
  const parsed = parseYaml(raw) as unknown
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).pages)
  ) {
    throw new Error(`docs-manifest.yaml: invalid shape at ${manifestPath}`)
  }
  const manifest = parsed as DocsManifest
  _manifestCache = manifest
  _manifestPathCached = manifestPath
  _manifestMtimeCached = mtime
  return manifest
}

function parseDocFile(
  rootDir: string,
  slug: string,
  manifestTitle: string | undefined,
): DocPage | null {
  const relativePath = slug + '.md'
  const fullPath = path.join(rootDir, relativePath)
  if (!fs.existsSync(fullPath)) return null

  const raw = fs.readFileSync(fullPath, 'utf-8')
  const parsed = matter(raw)
  const data = parsed.data as Record<string, unknown>

  const parts = slug.split('/')
  const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : null

  // Title precedence: manifest override → frontmatter title → filename humanized
  const titleFromFm = typeof data.title === 'string' ? data.title : ''
  const title =
    manifestTitle ||
    titleFromFm ||
    path.basename(slug).replace(/-/g, ' ')

  const description =
    typeof data.description === 'string' ? data.description : ''

  return {
    slug,
    title,
    description,
    content: parsed.content,
    order: 0, // unused — manifest position is authoritative
    folder,
  }
}

export function getAllPages(
  rootDir: string = DEFAULT_DOCS_DIR,
  manifestPath: string = DEFAULT_MANIFEST_PATH,
): Array<DocPage> {
  const manifest = loadDocsManifest(manifestPath)
  const pages: Array<DocPage> = []
  for (const entry of manifest.pages) {
    const page = parseDocFile(rootDir, entry.slug, entry.title)
    if (page) pages.push(page)
  }
  return pages
}

export function loadDocPage(
  slug: string,
  rootDir: string = DEFAULT_DOCS_DIR,
  manifestPath: string = DEFAULT_MANIFEST_PATH,
): DocPage | null {
  const manifest = loadDocsManifest(manifestPath)
  const entry = manifest.pages.find((e) => e.slug === slug)
  if (!entry) return null
  return parseDocFile(rootDir, entry.slug, entry.title) ?? null
}

export function scanDocsTree(
  rootDir: string = DEFAULT_DOCS_DIR,
  manifestPath: string = DEFAULT_MANIFEST_PATH,
): DocsTree {
  const pages = getAllPages(rootDir, manifestPath)
  const folderMap = new Map<string, Array<{ slug: string; title: string }>>()
  const rootPages: Array<{ slug: string; title: string }> = []

  for (const page of pages) {
    if (page.folder) {
      const list = folderMap.get(page.folder) ?? []
      list.push({ slug: page.slug, title: page.title })
      folderMap.set(page.folder, list)
    } else {
      rootPages.push({ slug: page.slug, title: page.title })
    }
  }

  // Folders preserve manifest order (folderMap insertion order), no re-sort needed.
  const folders: Array<DocFolder> = Array.from(folderMap.entries()).map(
    ([name, list]) => ({ name, pages: list }),
  )

  return { rootPages, folders }
}

export function getAdjacentPages(
  slug: string,
  rootDir: string = DEFAULT_DOCS_DIR,
  manifestPath: string = DEFAULT_MANIFEST_PATH,
): {
  prev: { slug: string; title: string } | null
  next: { slug: string; title: string } | null
} {
  const pages = getAllPages(rootDir, manifestPath)
  const idx = pages.findIndex((p) => p.slug === slug)
  if (idx === -1) return { prev: null, next: null }
  const prev = idx > 0 ? pages[idx - 1] : null
  const next = idx < pages.length - 1 ? pages[idx + 1] : null
  return {
    prev: prev ? { slug: prev.slug, title: prev.title } : null,
    next: next ? { slug: next.slug, title: next.title } : null,
  }
}
