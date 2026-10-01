import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'
import {
  getExplicitProfileWikiRoot,
  getKnowledgeBaseEffectiveRoot,
  isAllowedLocalKnowledgePath,
  isSymlinkFreeBelow,
  readKnowledgeBaseConfig,
} from './knowledge-config'
import { getHermesRoot } from './claude-paths'
import { getProfileMatrixMemoryDir } from './memory-profile'
import { isWithinRealRoot } from './path-containment'
import type { KnowledgeBaseSource } from './knowledge-config'

export type WikiPageMeta = {
  path: string
  name: string
  title: string
  type?: string
  domain?: string
  status?: string
  tags: Array<string>
  summary?: string
  created?: string
  updated?: string
  size: number
  modified: string
  wikilinks: Array<string>
}

export type WikiLink = {
  source: string
  target: string
}

type FrontmatterData = {
  title?: string
  type?: string
  domain?: string
  status?: string
  tags?: unknown
  summary?: string
  created?: string
  updated?: string
}

type ParsedKnowledgePage = {
  meta: WikiPageMeta
  content: string
  raw: string
}

function shouldSkipDirectory(name: string): boolean {
  return name === '.git' || name === 'node_modules'
}

function normalizeTitle(name: string): string {
  return name.replace(/\.md$/i, '')
}

function normalizeTagList(input: unknown): Array<string> {
  if (Array.isArray(input)) {
    return input.map((value) => String(value).trim()).filter(Boolean)
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  }
  return []
}

function normalizeFrontmatterValue(input: unknown): string | undefined {
  if (input == null) return undefined
  const value = String(input).trim()
  return value || undefined
}

function parseFrontmatter(raw: string): {
  data: FrontmatterData
  content: string
} {
  if (!raw.startsWith('---')) {
    return { data: {}, content: raw }
  }

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) {
    return { data: {}, content: raw }
  }

  try {
    const parsed = YAML.parse(match[1])
    return {
      data:
        parsed && typeof parsed === 'object' ? (parsed as FrontmatterData) : {},
      content: match[2] || '',
    }
  } catch {
    return { data: {}, content: match[2] || raw }
  }
}

function cleanWikilinkTarget(input: string): string {
  return input.split('|')[0]?.split('#')[0]?.trim() || ''
}

function extractWikilinks(content: string): Array<string> {
  const links = new Set<string>()
  const regex = /\[\[([^\]]+)\]\]/g
  let match: RegExpExecArray | null = null
  while ((match = regex.exec(content)) !== null) {
    const target = cleanWikilinkTarget(match[1] || '')
    if (target) links.add(target)
  }
  return Array.from(links)
}

// ─── Path-segment validation ───────────────────────────────────────────────────

/**
 * Validate a user-supplied path segment (repo name component, branch, or
 * sub-path) before it is concatenated into a filesystem path via path.join.
 *
 * Rules (applied in order):
 *  1. Must be a non-empty string.
 *  2. Must not contain null bytes.
 *  3. Must not be, or start with, an absolute separator ('/' or '\').
 *  4. No path component may be '..' (dot-dot traversal).
 *  5. The resolved final path must remain inside `expectedRoot` (containment).
 *
 * Git branch names allow '/' (e.g. feature/x, release-1.2) so slashes are
 * permitted; only the dot-dot pattern and absolute-path escapes are blocked.
 *
 * @throws {Error} with a descriptive message if validation fails.
 */
export function validateKnowledgeCachePath(
  resolvedPath: string,
  expectedRoot: string,
): void {
  // Normalise both sides so trailing-sep differences don't matter.
  const root = expectedRoot.endsWith(path.sep)
    ? expectedRoot
    : expectedRoot + path.sep
  if (resolvedPath !== expectedRoot && !resolvedPath.startsWith(root)) {
    throw new Error(
      `Cache path escaped the knowledge-cache root: ${resolvedPath}`,
    )
  }
}

/**
 * Validate a single user-supplied segment (branch or repo org/name) that will
 * be embedded in a path.join call.  Rejects values that could escape the
 * intended directory before path.join is even called.
 */
export function validateKnowledgePathSegment(
  value: string,
  label: string,
): void {
  if (!value || typeof value !== 'string') {
    throw new Error(`${label} must be a non-empty string`)
  }
  if (value.includes('\0')) {
    throw new Error(`${label} must not contain null bytes`)
  }
  if (value.startsWith('/') || value.startsWith('\\')) {
    throw new Error(`${label} must not be an absolute path`)
  }
  // Split on both posix and windows separators then check each component.
  const parts = value.split(/[/\\]/)
  for (const part of parts) {
    if (part === '..') {
      throw new Error(`${label} must not contain '..' path traversal segments`)
    }
  }
}

// ─── Legacy env-var fallback ──────────────────────────────────────────────────

function getLegacyKnowledgeRoot(profile?: string): string {
  return getKnowledgeBaseEffectiveRoot(profile)
}

// ─── GitHub Knowledge Provider ─────────────────────────────────────────────────

type GitHubEntry =
  | { type: 'file'; name: string; path: string; sha: string; content?: string }
  | { type: 'dir'; name: string; path: string; sha: string }

// Bounds on a GitHub sync so a huge or hostile repo can't fill the disk or
// run unbounded API calls.
const GITHUB_SYNC_MAX_DEPTH = 8
const GITHUB_SYNC_MAX_ENTRIES = 2000 // .md files + directories
const GITHUB_SYNC_MAX_BYTES = 50 * 1024 * 1024

class GitHubKnowledgeProvider {
  private readonly cacheDir: string
  private readonly branch: string
  private syncedEntries = 0
  private syncedBytes = 0

  constructor(
    private readonly repo: string,
    branch: string,
    private readonly repoPath: string,
  ) {
    // Validate user-supplied segments before embedding them in a path.join.
    validateKnowledgePathSegment(branch, 'branch')
    validateKnowledgePathSegment(repo, 'repo')

    const safeRepo = repo.replace('/', '_')
    const safePath = repoPath.replace(/^\//, '').replace(/\//g, '_')
    this.branch = branch
    const expectedRoot = path.join(os.homedir(), '.claude', 'knowledge-cache')
    const base = path.join(expectedRoot, 'github', safeRepo, branch, safePath)
    // Containment guard: even after all substitutions the resolved path must
    // stay inside the knowledge-cache root.
    validateKnowledgeCachePath(base, expectedRoot)
    this.cacheDir = base
  }

  /** Fetch + decode the GitHub repo into the local cache directory. */
  async sync(): Promise<void> {
    this.syncedEntries = 0
    this.syncedBytes = 0
    try {
      await this.fetchDir(this.repoPath, 0)
    } catch (err) {
      throw new Error(
        `GitHub sync failed for ${this.repo} (branch ${this.branch}): ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /** Check whether the local cache is present and non-empty. */
  isCached(): boolean {
    try {
      return (
        fs.existsSync(this.cacheDir) && fs.readdirSync(this.cacheDir).length > 0
      )
    } catch {
      return false
    }
  }

  get root(): string {
    return this.cacheDir
  }

  private apiUrl(repoPath: string): string {
    const encodedPath = repoPath
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/')
    return `https://api.github.com/repos/${this.repo}/contents/${encodedPath}?ref=${encodeURIComponent(this.branch)}`
  }

  private async fetchDir(dirPath: string, depth: number): Promise<void> {
    if (depth > GITHUB_SYNC_MAX_DEPTH) {
      throw new Error(`Repo nesting exceeds ${GITHUB_SYNC_MAX_DEPTH} levels`)
    }
    const res = await fetch(this.apiUrl(dirPath), {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'hermes-switchui',
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`GitHub API ${res.status}: ${body}`)
    }
    const entries = (await res.json()) as Array<GitHubEntry>
    const base = this.repoPath.split('/').filter(Boolean)

    for (const entry of entries) {
      // Hostile/odd names never reach the filesystem.
      if (
        !entry.name ||
        entry.name === '.' ||
        entry.name === '..' ||
        entry.name === '.git' ||
        /[\\/\0]/.test(entry.name)
      )
        continue
      // Mirror the repo layout under cacheDir (keeps nested dirs from
      // flattening into each other) using entry.path relative to repoPath.
      const segments = String(entry.path).split('/').filter(Boolean)
      if (
        segments.length <= base.length ||
        base.some((seg, i) => segments[i] !== seg) ||
        segments.at(-1) !== entry.name ||
        segments.some(
          (seg) => seg === '.' || seg === '..' || /[\\\0]/.test(seg),
        )
      )
        continue
      const fullPath = path.join(this.cacheDir, ...segments.slice(base.length))
      if (!isWithinRealRoot(this.cacheDir, fullPath)) continue

      const isDir = entry.type === 'dir'
      if (!isDir && !entry.name.toLowerCase().endsWith('.md')) continue
      if (++this.syncedEntries > GITHUB_SYNC_MAX_ENTRIES) {
        throw new Error(`Repo exceeds ${GITHUB_SYNC_MAX_ENTRIES} files/dirs`)
      }
      if (isDir) {
        fs.mkdirSync(fullPath, { recursive: true })
        await this.fetchDir(entry.path, depth + 1)
      } else {
        const content = await this.fetchFile(entry)
        this.syncedBytes += Buffer.byteLength(content, 'utf-8')
        if (this.syncedBytes > GITHUB_SYNC_MAX_BYTES) {
          throw new Error('Repo exceeds 50 MB of markdown')
        }
        fs.mkdirSync(path.dirname(fullPath), { recursive: true })
        fs.writeFileSync(fullPath, content, 'utf-8')
      }
    }
  }

  private async fetchFile(entry: {
    path: string
    sha: string
  }): Promise<string> {
    const res = await fetch(this.apiUrl(entry.path), {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'hermes-switchui',
      },
    })
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status} for ${entry.path}`)
    }
    const data = (await res.json()) as { content?: string; encoding?: string }
    if (!data.content)
      throw new Error(`No content in GitHub response for ${entry.path}`)
    if (data.encoding === 'base64') {
      return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString(
        'utf-8',
      )
    }
    return data.content.replace(/\n/g, '')
  }
}

// ─── Config-aware root resolution ──────────────────────────────────────────────

/** `profile` must be pre-validated (isMemoryProfile). GitHub sources ignore it. */
function getKnowledgeRoot(profile?: string): string {
  const config = readKnowledgeBaseConfig()
  const source = config.source

  if (source.type === 'github') {
    const provider = new GitHubKnowledgeProvider(
      source.repo,
      source.branch,
      source.path,
    )
    return provider.root
  }

  // local — a non-default profile never uses the configured path.
  const profileWiki = getExplicitProfileWikiRoot(profile)
  if (profileWiki) return profileWiki
  const p = source.path.trim()
  if (p) {
    return path.resolve(p.replace(/^~\//, `${os.homedir()}/`))
  }
  return getLegacyKnowledgeRoot(profile)
}

export function knowledgeRootExists(profile?: string): boolean {
  try {
    const root = getKnowledgeRoot(profile)
    if (!root) return false
    // For GitHub, check cache; for local, check filesystem
    const config = readKnowledgeBaseConfig()
    if (config.source.type === 'github') {
      const provider = new GitHubKnowledgeProvider(
        config.source.repo,
        config.source.branch,
        config.source.path,
      )
      return provider.isCached()
    }
    return fs.existsSync(root)
  } catch {
    return false
  }
}

function getKnowledgeSource(): KnowledgeBaseSource {
  return readKnowledgeBaseConfig().source
}

export async function syncKnowledgeSource(): Promise<{
  source: KnowledgeBaseSource
  success: boolean
  error?: string
}> {
  const source = getKnowledgeSource()
  if (source.type !== 'github') {
    return { source, success: true }
  }
  try {
    const provider = new GitHubKnowledgeProvider(
      source.repo,
      source.branch,
      source.path,
    )
    await provider.sync()
    return { source, success: true }
  } catch (err) {
    return {
      source,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

function normalizeRelativeKnowledgePath(input: string): string {
  const normalized = input.replace(/\\/g, '/').trim()
  if (!normalized) throw new Error('Path is required')
  if (normalized.startsWith('/'))
    throw new Error('Absolute paths are not allowed')
  if (normalized.includes('..'))
    throw new Error('Path traversal is not allowed')
  if (!normalized.toLowerCase().endsWith('.md'))
    throw new Error('Only Markdown files are allowed')
  return normalized
}

// Re-checked on every read/write: knowledge-config.json may have been
// hand-edited to point outside the allowed wiki roots since it was validated.
// GitHub sources live in the validated knowledge-cache dir instead.
function assertAllowedLocalRoot(profile?: string): void {
  if (readKnowledgeBaseConfig().source.type !== 'local') return
  const root = getKnowledgeRoot(profile)
  // A profile's own matrix-memory wiki is a dedicated wiki dir; `default`'s
  // ($HERMES_HOME/matrix-memory/wiki) is not on isAllowedLocalKnowledgePath's list.
  // A symlink anywhere below HERMES_HOME (e.g. matrix-memory/wiki → skills/)
  // voids the bypass.
  const profileWiki =
    profile && path.join(getProfileMatrixMemoryDir(profile), 'wiki')
  if (
    profileWiki &&
    path.resolve(root) === path.resolve(profileWiki) &&
    isSymlinkFreeBelow(getHermesRoot(), profileWiki)
  )
    return
  if (!isAllowedLocalKnowledgePath(root)) {
    throw new Error('Knowledge root is not allowed: not a wiki directory')
  }
}

function resolveKnowledgeFilePath(
  relativePath: string,
  profile?: string,
): {
  fullPath: string
  relativePath: string
} {
  const safeRelativePath = normalizeRelativeKnowledgePath(relativePath)
  const knowledgeRoot = path.resolve(getKnowledgeRoot(profile))
  const fullPath = path.resolve(knowledgeRoot, safeRelativePath)
  const relativeFromRoot = path.relative(knowledgeRoot, fullPath)
  if (
    relativeFromRoot.startsWith('..') ||
    path.isAbsolute(relativeFromRoot) ||
    !isWithinRealRoot(knowledgeRoot, fullPath)
  ) {
    throw new Error('Resolved path is outside knowledge root')
  }
  return { fullPath, relativePath: safeRelativePath }
}

// ─── Page parsing ─────────────────────────────────────────────────────────────

function buildPageMeta(
  relativePath: string,
  stats: fs.Stats,
  raw: string,
): ParsedKnowledgePage {
  const { data, content } = parseFrontmatter(raw)
  const modified = stats.mtime.toISOString()
  const name = path.basename(relativePath)
  const title = normalizeFrontmatterValue(data.title) || normalizeTitle(name)
  const updated = normalizeFrontmatterValue(data.updated) || modified

  return {
    meta: {
      path: relativePath,
      name,
      title,
      type: normalizeFrontmatterValue(data.type),
      domain: normalizeFrontmatterValue(data.domain),
      status: normalizeFrontmatterValue(data.status),
      tags: normalizeTagList(data.tags),
      summary: normalizeFrontmatterValue(data.summary),
      created: normalizeFrontmatterValue(data.created),
      updated,
      size: stats.size,
      modified,
      wikilinks: extractWikilinks(content),
    },
    content,
    raw,
  }
}

function readParsedKnowledgeFile(
  fullPath: string,
  relativePath: string,
): ParsedKnowledgePage | null {
  try {
    const stats = fs.statSync(fullPath)
    if (!stats.isFile()) return null
    const raw = fs.readFileSync(fullPath, 'utf-8')
    return buildPageMeta(relativePath, stats, raw)
  } catch {
    return null
  }
}

function walkKnowledgeDir(
  results: Array<ParsedKnowledgePage>,
  knowledgeRoot: string,
  dirPath: string,
) {
  let dirEntries: Array<string>
  try {
    dirEntries = fs.readdirSync(dirPath)
  } catch {
    return
  }

  for (const name of dirEntries) {
    const fullPath = path.join(dirPath, name)
    let stats: fs.Stats
    try {
      stats = fs.statSync(fullPath)
    } catch {
      continue
    }
    // A symlink planted in the wiki must not pull outside files into list/search.
    if (!isWithinRealRoot(knowledgeRoot, fullPath)) continue

    if (stats.isDirectory()) {
      if (shouldSkipDirectory(name)) continue
      walkKnowledgeDir(results, knowledgeRoot, fullPath)
      continue
    }

    if (!name.toLowerCase().endsWith('.md')) continue

    const relativePath = path
      .relative(knowledgeRoot, fullPath)
      .replace(/\\\\/g, '/')
    if (
      !relativePath ||
      relativePath.startsWith('..') ||
      path.isAbsolute(relativePath)
    )
      continue

    const parsed = readParsedKnowledgeFile(fullPath, relativePath)
    if (parsed) results.push(parsed)
  }
}

function getParsedKnowledgePages(profile?: string): Array<ParsedKnowledgePage> {
  const knowledgeRoot = path.resolve(getKnowledgeRoot(profile))
  if (!fs.existsSync(knowledgeRoot)) return []

  const results: Array<ParsedKnowledgePage> = []
  walkKnowledgeDir(results, knowledgeRoot, knowledgeRoot)
  results.sort((a, b) => {
    const updatedDiff =
      Date.parse(b.meta.updated || b.meta.modified) -
      Date.parse(a.meta.updated || a.meta.modified)
    if (updatedDiff !== 0) return updatedDiff
    return a.meta.path.localeCompare(b.meta.path)
  })
  return results
}

function createWikilinkResolver(
  pages: Array<ParsedKnowledgePage>,
): (linkText: string) => string | null {
  const byPath = new Map<string, string>()
  const byName = new Map<string, string>()
  // Basename collisions (a/x.md vs b/x.md): shortest path wins, then alphabetical.
  const ordered = pages
    .map((page) => page.meta.path)
    .sort((a, b) => a.length - b.length || a.localeCompare(b))

  for (const pagePath of ordered) {
    byPath.set(pagePath.replace(/\.md$/i, '').toLowerCase(), pagePath)
    const name = path.basename(pagePath, '.md').toLowerCase()
    if (!byName.has(name)) byName.set(name, pagePath)
  }

  return (linkText: string) => {
    const cleaned = cleanWikilinkTarget(linkText)
    if (!cleaned) return null

    const normalized = cleaned
      .replace(/\\\\/g, '/')
      .trim()
      .replace(/\.md$/i, '')
      .toLowerCase()
    if (!normalized) return null

    return byPath.get(normalized) || byName.get(normalized) || null
  }
}

// Pages under `raw/` are auto-generated source ingest, not curated wiki content.
// Exclude them from the wiki list + graph so the user only sees curated pages.
function isCuratedPage(p: string): boolean {
  return !p.startsWith('raw/') && !p.startsWith('raw\\')
}

export function listKnowledgePages(profile?: string): Array<WikiPageMeta> {
  assertAllowedLocalRoot(profile)
  return getParsedKnowledgePages(profile)
    .filter((page) => isCuratedPage(page.meta.path))
    .map((page) => page.meta)
}

export function resolveWikilink(
  linkText: string,
  profile?: string,
): string | null {
  return createWikilinkResolver(getParsedKnowledgePages(profile))(linkText)
}

export function readKnowledgePage(
  relativePath: string,
  profile?: string,
): {
  meta: WikiPageMeta
  /** Body with frontmatter stripped — for rendering. */
  content: string
  /** Full file incl. frontmatter — what an editor must load and save back. */
  raw: string
  backlinks: Array<string>
  /** Each of this page's wikilink targets → resolved page path, or null if missing. */
  links: Record<string, string | null>
} {
  assertAllowedLocalRoot(profile)
  const { fullPath, relativePath: safeRelativePath } = resolveKnowledgeFilePath(
    relativePath,
    profile,
  )
  const parsed = readParsedKnowledgeFile(fullPath, safeRelativePath)
  if (!parsed) {
    throw new Error(`ENOENT: Knowledge page not found: ${safeRelativePath}`)
  }

  const pages = getParsedKnowledgePages(profile)
  const resolveLink = createWikilinkResolver(pages)
  const backlinks = pages
    .filter((page) => page.meta.path !== safeRelativePath)
    .filter((page) =>
      page.meta.wikilinks.some(
        (link) => resolveLink(link) === safeRelativePath,
      ),
    )
    .map((page) => page.meta.path)

  return {
    meta: parsed.meta,
    content: parsed.content,
    raw: parsed.raw,
    backlinks,
    links: Object.fromEntries(
      parsed.meta.wikilinks.map((link) => [link, resolveLink(link)]),
    ),
  }
}

export type KnowledgeSearchHit = {
  path: string
  title: string
  line: number
  text: string
}

// ponytail: linear substring scan over every curated page per query — fine at
// ~10-500 pages; build an inverted index / SQLite FTS if the wiki grows past that.
export function searchKnowledgePages(
  query: string,
  profile?: string,
): Array<KnowledgeSearchHit> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  assertAllowedLocalRoot(profile)

  const titleHits: Array<KnowledgeSearchHit> = []
  const bodyHits: Array<KnowledgeSearchHit> = []
  for (const page of getParsedKnowledgePages(profile)) {
    if (!isCuratedPage(page.meta.path)) continue
    const title = page.meta.title.toLowerCase()
    const haystack = `${title}\n${page.meta.path.toLowerCase()}\n${page.raw.toLowerCase()}`
    if (!terms.every((t) => haystack.includes(t))) continue

    const lines = page.raw.split(/\r?\n/)
    const index = lines.findIndex((l) => l.toLowerCase().includes(terms[0]))
    const hit = {
      path: page.meta.path,
      title: page.meta.title,
      line: index + 1,
      text: index >= 0 ? (lines[index] || '').trim().slice(0, 200) : '',
    }
    if (terms.every((t) => title.includes(t))) titleHits.push(hit)
    else bodyHits.push(hit)
  }
  return [...titleHits, ...bodyHits].slice(0, 50)
}

export class KnowledgeConflictError extends Error {
  constructor(
    readonly current: WikiPageMeta,
    message = 'Page changed on disk since it was loaded',
  ) {
    super(message)
    this.name = 'KnowledgeConflictError'
  }
}

export function writeKnowledgePage(
  relativePath: string,
  content: string,
  options: {
    /** `modified` (mtime ISO) the editor loaded; mismatch → KnowledgeConflictError. */
    expectedModified?: string
    /** New-page create: KnowledgeConflictError if the path already exists. */
    createOnly?: boolean
    profile?: string
  } = {},
): WikiPageMeta {
  const { expectedModified, createOnly, profile } = options
  const config = readKnowledgeBaseConfig()
  if (config.source.type === 'github') {
    throw new Error('GitHub-backed wiki is read-only; edit upstream')
  }
  assertAllowedLocalRoot(profile)
  const { fullPath, relativePath: safeRelativePath } = resolveKnowledgeFilePath(
    relativePath,
    profile,
  )
  if (!isCuratedPage(safeRelativePath)) {
    throw new Error('Writes to raw/ are not allowed')
  }
  if (expectedModified && !createOnly) {
    const current = readParsedKnowledgeFile(fullPath, safeRelativePath)
    if (current && current.meta.modified !== expectedModified) {
      throw new KnowledgeConflictError(current.meta)
    }
  }
  const dir = path.dirname(fullPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  try {
    // 'wx' makes create-only atomic: no exists-check/write race.
    fs.writeFileSync(fullPath, content, {
      encoding: 'utf-8',
      flag: createOnly ? 'wx' : 'w',
    })
  } catch (err) {
    if (createOnly && (err as NodeJS.ErrnoException).code === 'EEXIST') {
      const current = readParsedKnowledgeFile(fullPath, safeRelativePath)
      if (current) {
        throw new KnowledgeConflictError(
          current.meta,
          `A page already exists at ${safeRelativePath}`,
        )
      }
    }
    throw err
  }
  const stats = fs.statSync(fullPath)
  const parsed = buildPageMeta(safeRelativePath, stats, content)
  return parsed.meta
}

export function deleteKnowledgePage(
  relativePath: string,
  profile?: string,
): void {
  const config = readKnowledgeBaseConfig()
  if (config.source.type === 'github') {
    throw new Error('GitHub-backed wiki is read-only; edit upstream')
  }
  assertAllowedLocalRoot(profile)
  const { fullPath, relativePath: safeRelativePath } = resolveKnowledgeFilePath(
    relativePath,
    profile,
  )
  if (!isCuratedPage(safeRelativePath)) {
    throw new Error('Writes to raw/ are not allowed')
  }
  if (!fs.existsSync(fullPath)) {
    throw new Error(`ENOENT: Knowledge page not found: ${relativePath}`)
  }
  fs.unlinkSync(fullPath)
}
