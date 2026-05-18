import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'

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

const DEFAULT_DOCS_DIR = path.join(process.cwd(), 'docs')

function findMarkdownFiles(dir: string, basePath = ''): Array<string> {
  if (!fs.existsSync(dir)) return []
  const out: Array<string> = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const rel = path.join(basePath, entry.name)
    if (entry.isDirectory()) {
      out.push(...findMarkdownFiles(full, rel))
    } else if (entry.name.endsWith('.md')) {
      out.push(rel)
    }
  }
  return out
}

function parseDocFile(rootDir: string, relativePath: string): DocPage | null {
  const fullPath = path.join(rootDir, relativePath)
  const raw = fs.readFileSync(fullPath, 'utf-8')
  const parsed = matter(raw)
  const data = parsed.data as Record<string, unknown>

  if (data.published !== true) return null

  const slug = relativePath.replace(/\.md$/, '').replace(/\\/g, '/')
  const parts = slug.split('/')
  const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : null

  const titleFromFm = typeof data.title === 'string' ? data.title : ''
  const title = titleFromFm || path.basename(slug).replace(/-/g, ' ')
  const description = typeof data.description === 'string' ? data.description : ''
  const order = typeof data.order === 'number' ? data.order : 999

  return {
    slug,
    title,
    description,
    content: parsed.content,
    order,
    folder,
  }
}

export function getAllPages(rootDir: string = DEFAULT_DOCS_DIR): Array<DocPage> {
  const files = findMarkdownFiles(rootDir)
  return files
    .map((f) => parseDocFile(rootDir, f))
    .filter((p): p is DocPage => p !== null)
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order
      return a.slug.localeCompare(b.slug)
    })
}

export function loadDocPage(
  slug: string,
  rootDir: string = DEFAULT_DOCS_DIR,
): DocPage | null {
  return getAllPages(rootDir).find((p) => p.slug === slug) ?? null
}

export function scanDocsTree(rootDir: string = DEFAULT_DOCS_DIR): DocsTree {
  const pages = getAllPages(rootDir)
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

  const folders: Array<DocFolder> = Array.from(folderMap.entries())
    .map(([name, list]) => ({ name, pages: list }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { rootPages, folders }
}

export function getAdjacentPages(
  slug: string,
  rootDir: string = DEFAULT_DOCS_DIR,
): {
  prev: { slug: string; title: string } | null
  next: { slug: string; title: string } | null
} {
  const pages = getAllPages(rootDir)
  const idx = pages.findIndex((p) => p.slug === slug)
  if (idx === -1) return { prev: null, next: null }
  const prev = idx > 0 ? pages[idx - 1] : null
  const next = idx < pages.length - 1 ? pages[idx + 1] : null
  return {
    prev: prev ? { slug: prev.slug, title: prev.title } : null,
    next: next ? { slug: next.slug, title: next.title } : null,
  }
}
