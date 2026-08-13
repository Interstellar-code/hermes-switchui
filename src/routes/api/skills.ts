import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  BEARER_TOKEN,
  CLAUDE_API,
  CLAUDE_UPGRADE_INSTRUCTIONS,
  dashboardFetch,
  ensureGatewayProbed,
  getCapabilities,
} from '../../server/gateway-capabilities'
import { getActiveProfileName, listProfiles } from '../../server/profiles-browser'
import { requireJsonContentType } from '../../server/rate-limit'
import { createCapabilityUnavailablePayload } from '@/lib/feature-gates'

function getSkillsDir(): string {
  return (
    process.env.HERMES_SKILLS_DIR ||
    path.join(
      process.env.HERMES_HOME || path.join(os.homedir(), '.hermes'),
      'skills',
    )
  )
}

type LocalSkillMeta = {
  path: string
  author: string
  name: string
  description: string
  content: string
  categoryHint: string
  tags: Array<string>
  triggers: Array<string>
  homepage: string | null
}

type ProfileFilterOption = {
  name: string
  label: string
  active: boolean
  tier: number | null
  skillCount: number
  localSkillCount: number
}

function readFrontmatterValue(block: string, key: string): string {
  const match = block.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'im'))
  return match?.[1]?.trim().replace(/^["']|["']$/g, '') || ''
}

function readFrontmatterList(block: string, key: string): Array<string> {
  const inline = readFrontmatterValue(block, key)
  if (inline) {
    const normalized = inline.replace(/^\[|\]$/g, '')
    return normalized
      .split(',')
      .map((entry) => entry.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }

  const lines = block.split('\n')
  const items: Array<string> = []
  let collecting = false
  for (const line of lines) {
    if (!collecting && new RegExp(`^${key}:\\s*$`, 'i').test(line.trim())) {
      collecting = true
      continue
    }
    if (!collecting) continue
    const trimmed = line.trim()
    if (!trimmed.startsWith('- ')) break
    items.push(trimmed.slice(2).trim().replace(/^["']|["']$/g, ''))
  }
  return items.filter(Boolean)
}

async function readSkillMeta(
  skillDir: string,
  categoryHint: string,
): Promise<LocalSkillMeta> {
  try {
    const raw = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8')
    const fmEnd = raw.indexOf('\n---', 4)
    const fm = fmEnd > 0 ? raw.slice(0, fmEnd) : raw.slice(0, 2048)
    const body = fmEnd > 0 ? raw.slice(fmEnd + 4) : raw
    const description =
      readFrontmatterValue(fm, 'description') ||
      body
        .split('\n')
        .map((line) => line.trim())
        .find(
          (line) =>
            Boolean(line) && !line.startsWith('#') && !line.startsWith('```'),
        ) ||
      ''
    return {
      path: skillDir,
      author: readFrontmatterValue(fm, 'author'),
      name:
        readFrontmatterValue(fm, 'name') ||
        path.basename(skillDir).replace(/[-_]+/g, ' '),
      description,
      content: raw,
      categoryHint: readFrontmatterValue(fm, 'category') || categoryHint,
      tags: readFrontmatterList(fm, 'tags'),
      triggers: readFrontmatterList(fm, 'triggers'),
      homepage: readFrontmatterValue(fm, 'homepage') || null,
    }
  } catch {
    return {
      path: skillDir,
      author: '',
      name: path.basename(skillDir).replace(/[-_]+/g, ' '),
      description: '',
      content: '',
      categoryHint,
      tags: [],
      triggers: [],
      homepage: null,
    }
  }
}

const EXCLUDED_SKILL_DIRS = new Set([
  '.git', '.github', '.hub', '.archive', '.venv', 'venv',
  'node_modules', 'site-packages', '__pycache__',
  '.tox', '.nox', '.pytest_cache', '.mypy_cache', '.ruff_cache',
])

const SUPPORT_DIRS = new Set(['references', 'templates', 'assets', 'scripts'])

export async function scanSkillRoot(root: string): Promise<Map<string, LocalSkillMeta>> {
  const map = new Map<string, LocalSkillMeta>()
  try {
    await fs.access(root)
  } catch {
    return map
  }

  const collected: Array<{ dir: string; rel: string }> = []
  const stack: Array<{ dir: string; rel: string }> = [{ dir: root, rel: '' }]

  while (stack.length > 0) {
    const { dir: current, rel: currentRel } = stack.pop()!
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }

    if (currentRel && entries.some((e: { isFile: () => boolean; name: string }) => e.isFile() && e.name === 'SKILL.md')) {
      collected.push({ dir: current, rel: currentRel })
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      if (EXCLUDED_SKILL_DIRS.has(entry.name)) continue
      const childRel = currentRel ? path.join(currentRel, entry.name) : entry.name
      stack.push({ dir: path.join(current, entry.name), rel: childRel })
    }
  }

  const skillRelSet = new Set(collected.map((c) => c.rel))
  const real = collected.filter(({ rel }) => {
    const leaf = path.basename(rel)
    if (!SUPPORT_DIRS.has(leaf)) return true
    const parentRel = path.dirname(rel)
    return parentRel === '.' || !skillRelSet.has(parentRel)
  })

  const metas = await Promise.all(
    real.map(({ dir, rel }) => {
      const segments = rel.split(path.sep)
      const categoryHint = segments.length > 1 ? segments[0] : 'general'
      return readSkillMeta(dir, categoryHint)
    }),
  )
  real.forEach(({ rel }, i) => {
    const leafName = path.basename(rel)
    if (!map.has(leafName)) map.set(leafName, metas[i])
  })

  return map
}

function mergeSkillSummaries(
  existing: SkillSummary | undefined,
  incoming: SkillSummary,
): SkillSummary {
  if (!existing) return incoming

  return {
    ...existing,
    ...incoming,
    description: existing.description || incoming.description,
    author: existing.author || incoming.author,
    triggers: existing.triggers.length > 0 ? existing.triggers : incoming.triggers,
    tags: existing.tags.length > 0 ? existing.tags : incoming.tags,
    homepage: existing.homepage || incoming.homepage,
    content: existing.content || incoming.content,
    fileCount: Math.max(existing.fileCount, incoming.fileCount),
    sourcePath: existing.sourcePath || incoming.sourcePath,
    provenance: existing.provenance || incoming.provenance,
    usage: Math.max(existing.usage, incoming.usage),
    enabled: existing.enabled,
    installed: existing.installed,
    builtin: existing.builtin || incoming.builtin,
    security: existing.security,
    origin:
      existing.origin === 'builtin' || incoming.origin === 'builtin'
        ? 'builtin'
        : existing.origin === 'agent-created' || incoming.origin === 'agent-created'
          ? 'agent-created'
          : incoming.origin,
    profileNames: Array.from(
      new Set([...(existing.profileNames ?? []), ...(incoming.profileNames ?? [])]),
    ).sort(),
    profileCount: Math.max(
      existing.profileCount ?? existing.profileNames?.length ?? 0,
      incoming.profileCount ?? incoming.profileNames?.length ?? 0,
    ),
    shared: existing.shared || incoming.shared,
  }
}

function toLocalSkillSummary(id: string, meta: LocalSkillMeta): SkillSummary {
  return {
    id,
    slug: slugify(id),
    name: meta.name || id,
    description: meta.description,
    author: meta.author,
    triggers: meta.triggers,
    tags: meta.tags,
    homepage: meta.homepage,
    category: normalizeCategoryLabel(meta.categoryHint || 'Productivity'),
    icon: '✨',
    content: meta.content,
    fileCount: 1,
    sourcePath: meta.path,
    installed: true,
    enabled: true,
    builtin: false,
    featuredGroup: undefined,
    security: { level: 'safe', flags: [], score: 0 },
    origin: 'marketplace',
    // A row the filesystem scan found has no agent-side provenance or counter;
    // if the agent also knows it, `mergeSkillSummaries` fills both in.
    provenance: '',
    usage: 0,
    profileNames: [],
    profileCount: 0,
    shared: false,
  }
}

function matchesProfileFilter(skill: SkillSummary, profileName: string): boolean {
  if (profileName === 'all') return true
  const owners = skill.profileNames ?? []
  if (owners.length > 0) return owners.includes(profileName)
  return Boolean(skill.shared)
}

async function loadBundledManifest(): Promise<Set<string>> {
  const manifestPath = path.join(getSkillsDir(), '.bundled_manifest')
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8')
    return new Set(
      raw
        .split('\n')
        .map((line) => line.split(':')[0]?.trim() || '')
        .filter(Boolean),
    )
  } catch {
    return new Set()
  }
}

function deriveOrigin(
  skill: SkillSummary,
  bundled: Set<string>,
): SkillSummary['origin'] {
  if (bundled.has(skill.id) || bundled.has(skill.slug)) return 'builtin'
  if (skill.author === 'Hermes Agent' && skill.sourcePath) return 'agent-created'
  return 'marketplace'
}

type SkillsTab = 'installed' | 'marketplace' | 'featured'
type SkillsSort = 'name' | 'category'

type SecurityRisk = {
  level: 'safe' | 'low' | 'medium' | 'high'
  flags: Array<string>
  score: number
}

type SkillSummary = {
  id: string
  slug: string
  name: string
  description: string
  author: string
  triggers: Array<string>
  tags: Array<string>
  homepage: string | null
  category: string
  icon: string
  content: string
  fileCount: number
  sourcePath: string
  installed: boolean
  enabled: boolean
  builtin?: boolean
  featuredGroup?: string
  security: SecurityRisk
  origin: 'builtin' | 'agent-created' | 'marketplace'
  /**
   * Hermes' own `provenance` for this skill (`bundled` / `agent` / …), passed
   * through verbatim. Distinct from `origin`, which SwitchUI *derives* from the
   * author and the bundled manifest — when the agent tells us directly, that is
   * the better answer. `''` for rows discovered by the local filesystem scan.
   */
  provenance: string
  /** Hermes' invocation counter for this skill. `0` when it never ran / unknown. */
  usage: number
  profileNames?: Array<string>
  profileCount?: number
  shared?: boolean
}

const KNOWN_CATEGORIES = [
  'All',
  'Web & Frontend',
  'Coding Agents',
  'Git & GitHub',
  'DevOps & Cloud',
  'Browser & Automation',
  'Image & Video',
  'Search & Research',
  'AI & LLMs',
  'Productivity',
  'Marketing & Sales',
  'Communication',
  'Data & Analytics',
  'Finance & Crypto',
] as const

const FEATURED_SKILLS: Array<{ id: string; group: string }> = [
  { id: 'dbalve/fast-io', group: 'Most Popular' },
  { id: 'okoddcat/gitflow', group: 'Most Popular' },
  { id: 'atomtanstudio/craft-do', group: 'Most Popular' },
  { id: 'bro3886/gtasks-cli', group: 'New This Week' },
  { id: 'vvardhan14/pokerpal', group: 'New This Week' },
  {
    id: 'veeramanikandanr48/docker-containerization',
    group: 'Developer Tools',
  },
  { id: 'veeramanikandanr48/azure-auth', group: 'Developer Tools' },
  { id: 'dbalve/fastio-skills', group: 'Productivity' },
  { id: 'gillberto1/moltwallet', group: 'Productivity' },
  { id: 'veeramanikandanr48/backtest-expert', group: 'Productivity' },
]

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readStringArray(value: unknown): Array<string> {
  if (!Array.isArray(value)) return []
  return value.map((entry) => readString(entry)).filter(Boolean)
}

function slugify(input: string): string {
  const result = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
  return result || 'skill'
}

function normalizeSecurity(value: unknown): SecurityRisk {
  const record = asRecord(value)
  const level = readString(record.level)
  return {
    level:
      level === 'low' ||
      level === 'medium' ||
      level === 'high' ||
      level === 'safe'
        ? level
        : 'safe',
    flags: readStringArray(record.flags),
    score:
      typeof record.score === 'number' && Number.isFinite(record.score)
        ? record.score
        : 0,
  }
}

const CATEGORY_ALIASES: Record<string, string> = {
  research: 'Search & Research',
  'search-and-research': 'Search & Research',
  search: 'Search & Research',
  feeds: 'Search & Research',
  'web-frontend': 'Web & Frontend',
  frontend: 'Web & Frontend',
  web: 'Web & Frontend',
  'software-development': 'Coding Agents',
  coding: 'Coding Agents',
  development: 'Coding Agents',
  devops: 'DevOps & Cloud',
  cloud: 'DevOps & Cloud',
  'devops-cloud': 'DevOps & Cloud',
  mlops: 'DevOps & Cloud',
  git: 'Git & GitHub',
  github: 'Git & GitHub',
  'git-github': 'Git & GitHub',
  browser: 'Browser & Automation',
  automation: 'Browser & Automation',
  'browser-automation': 'Browser & Automation',
  image: 'Image & Video',
  video: 'Image & Video',
  media: 'Image & Video',
  creative: 'Image & Video',
  'image-video': 'Image & Video',
  gifs: 'Image & Video',
  diagramming: 'Image & Video',
  'autonomous-ai-agents': 'AI & LLMs',
  ai: 'AI & LLMs',
  llm: 'AI & LLMs',
  agents: 'AI & LLMs',
  mcp: 'AI & LLMs',
  'inference-sh': 'AI & LLMs',
  'data-science': 'Data & Analytics',
  data: 'Data & Analytics',
  'social-media': 'Marketing & Sales',
  social: 'Marketing & Sales',
  email: 'Communication',
  'note-taking': 'Productivity',
  notetaking: 'Productivity',
  notes: 'Productivity',
  'smart-home': 'Productivity',
  apple: 'Productivity',
  leisure: 'Productivity',
  gaming: 'Productivity',
  'red-teaming': 'AI & LLMs',
  domain: 'Productivity',
  dogfood: 'Productivity',
  productivity: 'Productivity',
}

const KNOWN_CATEGORY_SET = new Set<string>(
  KNOWN_CATEGORIES.filter((c) => c !== 'All'),
)
const KNOWN_CATEGORY_LOWER = new Map<string, string>(
  Array.from(KNOWN_CATEGORY_SET).map((c) => [c.toLowerCase(), c]),
)

function normalizeCategoryLabel(raw: string): string {
  if (KNOWN_CATEGORY_SET.has(raw)) return raw
  const lower = raw.toLowerCase()
  const caseMatch = KNOWN_CATEGORY_LOWER.get(lower)
  if (caseMatch) return caseMatch
  const key = lower.replace(/[\s&]+/g, '-').replace(/-+/g, '-')
  return CATEGORY_ALIASES[key] || CATEGORY_ALIASES[lower] || raw
}

function guessCategory(record: Record<string, unknown>): string {
  const direct =
    readString(record.category) ||
    readString(record.group) ||
    readString(record.section)
  if (direct) return normalizeCategoryLabel(direct)
  const tags = readStringArray(record.tags).map((tag) => tag.toLowerCase())
  if (tags.some((tag) => tag.includes('frontend') || tag.includes('react'))) {
    return 'Web & Frontend'
  }
  if (tags.some((tag) => tag.includes('browser'))) {
    return 'Browser & Automation'
  }
  if (tags.some((tag) => tag.includes('git'))) {
    return 'Git & GitHub'
  }
  if (tags.some((tag) => tag.includes('research') || tag.includes('search'))) {
    return 'Search & Research'
  }
  if (tags.some((tag) => tag.includes('ai') || tag.includes('llm'))) {
    return 'AI & LLMs'
  }
  return 'Productivity'
}

function normalizeSkill(value: unknown): SkillSummary | null {
  const record = asRecord(value)
  const id =
    readString(record.id) || readString(record.slug) || readString(record.name)
  if (!id) return null

  const name = readString(record.name) || id
  const sourcePath =
    readString(record.sourcePath) ||
    readString(record.path) ||
    readString(record.file) ||
    ''

  return {
    id,
    slug: readString(record.slug) || slugify(id),
    name,
    description: readString(record.description),
    author:
      readString(record.author) ||
      readString(record.owner) ||
      readString(record.publisher),
    triggers: readStringArray(record.triggers),
    tags: readStringArray(record.tags),
    homepage: readString(record.homepage) || null,
    category: guessCategory(record),
    icon: readString(record.icon) || '✨',
    content:
      readString(record.content) ||
      readString(record.readme) ||
      readString(record.prompt),
    fileCount:
      typeof record.fileCount === 'number' && Number.isFinite(record.fileCount)
        ? record.fileCount
        : 0,
    sourcePath,
    // Claude /api/skills returns the installed skill inventory. Older payloads
    // omit explicit installed/enabled flags, so default to installed=true.
    installed: Boolean(record.installed ?? true),
    enabled: Boolean(record.enabled ?? record.installed ?? true),
    builtin: Boolean(record.builtin),
    featuredGroup: undefined,
    security: normalizeSecurity(record.security),
    origin: 'marketplace' as const,
    provenance: readString(record.provenance),
    usage:
      typeof record.usage === 'number' && Number.isFinite(record.usage)
        ? record.usage
        : 0,
  }
}

async function fetchClaudeSkills(): Promise<Array<SkillSummary>> {
  const capabilities = getCapabilities()
  const headers: Record<string, string> = {}
  if (BEARER_TOKEN) headers['Authorization'] = `Bearer ${BEARER_TOKEN}`

  const response = capabilities.dashboard.available
    ? await dashboardFetch('/api/skills')
    : await fetch(`${CLAUDE_API}/api/skills`, { headers })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(body || `Claude skills request failed (${response.status})`)
  }

  const payload = (await response.json()) as unknown
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(asRecord(payload).items)
      ? (asRecord(payload).items as Array<unknown>)
      : Array.isArray(asRecord(payload).skills)
        ? (asRecord(payload).skills as Array<unknown>)
        : []

  return items
    .map((entry) => normalizeSkill(entry))
    .filter((entry): entry is SkillSummary => entry !== null)
}

function matchesSearch(skill: SkillSummary, rawSearch: string): boolean {
  const search = rawSearch.trim().toLowerCase()
  if (!search) return true

  return [
    skill.id,
    skill.name,
    skill.description,
    skill.author,
    skill.category,
    ...skill.tags,
    ...skill.triggers,
  ]
    .join('\n')
    .toLowerCase()
    .includes(search)
}

function sortSkills(skills: Array<SkillSummary>, sort: SkillsSort) {
  return [...skills].sort((left, right) => {
    if (sort === 'category') {
      const categoryCompare = left.category.localeCompare(right.category)
      if (categoryCompare !== 0) return categoryCompare
    }
    return left.name.localeCompare(right.name)
  })
}

export const Route = createFileRoute('/api/skills')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const capabilities = await ensureGatewayProbed()
        if (!capabilities.skills) {
          return Response.json({
            ...createCapabilityUnavailablePayload('skills'),
            items: [],
            skills: [],
            total: 0,
            page: 1,
            categories: KNOWN_CATEGORIES,
          })
        }

        try {
          const url = new URL(request.url)
          const tabParam = url.searchParams.get('tab')
          const tab: SkillsTab =
            tabParam === 'installed' ||
            tabParam === 'marketplace' ||
            tabParam === 'featured'
              ? tabParam
              : 'installed'
          const rawSearch = (url.searchParams.get('search') || '').trim()
          const category = (url.searchParams.get('category') || 'All').trim()
          const origin = (url.searchParams.get('origin') || 'All').trim()
          const profileParam = (url.searchParams.get('profile') || '').trim()
          const sortParam = (url.searchParams.get('sort') || 'name').trim()
          const sort: SkillsSort =
            sortParam === 'category' || sortParam === 'name'
              ? sortParam
              : 'name'
          // `fields=summary` drops `content` — the whole SKILL.md body, which is
          // ~95% of this payload (1.0 MB vs 56 KB for the 88 rows on this
          // machine). Callers that only need the metadata (name, category,
          // provenance, usage) ask for it; the skills screen, which renders the
          // body, does not.
          const summaryOnly = url.searchParams.get('fields') === 'summary'
          const page = Math.max(1, Number(url.searchParams.get('page') || '1'))
          const limit = Math.min(
            1000,
            Math.max(1, Number(url.searchParams.get('limit') || '30')),
          )

          const profileSummaries = listProfiles()
          const activeProfile = getActiveProfileName()
          const selectedProfile =
            profileParam === 'all' || profileSummaries.some((p) => p.name === profileParam)
              ? profileParam || activeProfile
              : activeProfile

          const [sourceItems, bundledManifest, sharedSkillMap, profileSkillMaps] =
            await Promise.all([
              fetchClaudeSkills(),
              loadBundledManifest(),
              scanSkillRoot(getSkillsDir()),
              Promise.all(
                profileSummaries.map(async (profile) => [
                  profile.name,
                  await scanSkillRoot(path.join(profile.path, 'skills')),
                ] as const),
              ),
            ])

          const merged = new Map<string, SkillSummary>()
          const activeSkillMap = new Map<string, LocalSkillMeta>(
            profileSkillMaps.find(([name]) => name === activeProfile)?.[1] ?? [],
          )
          const upsert = (skill: SkillSummary) => {
            const key = skill.id
            merged.set(key, mergeSkillSummaries(merged.get(key), skill))
          }

          for (const skill of sourceItems) {
            const meta = activeSkillMap.get(skill.id) || activeSkillMap.get(skill.slug)
            const shared = Boolean(skill.sourcePath) && skill.sourcePath.startsWith(getSkillsDir())
            const next: SkillSummary = {
              ...skill,
              sourcePath: skill.sourcePath || meta?.path || '',
              author: skill.author || meta?.author || '',
              description: skill.description || meta?.description || '',
              content: skill.content || meta?.content || '',
              tags: skill.tags.length > 0 ? skill.tags : meta?.tags || [],
              triggers:
                skill.triggers.length > 0 ? skill.triggers : meta?.triggers || [],
              homepage: skill.homepage || meta?.homepage || null,
              category:
                skill.category !== 'Productivity'
                  ? skill.category
                  : normalizeCategoryLabel(meta?.categoryHint || skill.category),
              origin: deriveOrigin(
                {
                  ...skill,
                  sourcePath: skill.sourcePath || meta?.path || '',
                  author: skill.author || meta?.author || '',
                },
                bundledManifest,
              ),
              profileNames: activeProfile ? [activeProfile] : [],
              profileCount: activeProfile ? 1 : 0,
              shared,
            }
            upsert(next)
          }

          for (const [id, meta] of sharedSkillMap.entries()) {
            const skill = toLocalSkillSummary(id, meta)
            upsert({
              ...skill,
              origin: deriveOrigin(skill, bundledManifest),
              shared: true,
              profileNames: [],
              profileCount: 0,
            })
          }

          for (const [profileName, skillMap] of profileSkillMaps) {
            for (const [id, meta] of skillMap.entries()) {
              const skill = toLocalSkillSummary(id, meta)
              upsert({
                ...skill,
                origin: deriveOrigin(skill, bundledManifest),
                profileNames: [profileName],
                profileCount: 1,
                shared: false,
              })
            }
          }

          const allItems = Array.from(merged.values()).map((skill) => ({
            ...skill,
            profileNames: (skill.profileNames ?? []).sort(),
            profileCount: (skill.profileNames ?? []).length,
          }))
          const installedLookup = new Set(
            allItems.filter((skill) => skill.installed).map((skill) => skill.id),
          )

          const filteredByTab = allItems.filter((skill) => {
            if (tab === 'featured') return true
            if (tab === 'installed') return skill.installed
            return true
          })

          const featuredLookup = new Map(
            FEATURED_SKILLS.map((entry) => [entry.id, entry.group]),
          )

          const filteredWithoutProfile = sortSkills(
            filteredByTab
              .map((skill) => ({
                ...skill,
                installed: installedLookup.has(skill.id),
                featuredGroup: featuredLookup.get(skill.id),
              }))
              .filter((skill) => {
                if (tab === 'featured' && !skill.featuredGroup) return false
                if (!matchesSearch(skill, rawSearch)) return false
                if (category !== 'All' && skill.category !== category) {
                  return false
                }
                if (origin !== 'All' && skill.origin !== origin) return false
                return true
              }),
            sort,
          )

          const profileOptions: Array<ProfileFilterOption> = profileSummaries.map(
            (profile) => ({
              name: profile.name,
              label: profile.name,
              active: profile.active,
              tier:
                typeof profile.agent_ui?.tier === 'number'
                  ? profile.agent_ui.tier
                  : null,
              localSkillCount: profile.skillCount,
              skillCount: filteredWithoutProfile.filter((skill) =>
                matchesProfileFilter(skill, profile.name),
              ).length,
            }),
          )

          const filtered = filteredWithoutProfile.filter((skill) =>
            selectedProfile === 'all'
              ? true
              : matchesProfileFilter(skill, selectedProfile),
          )

          const total = filtered.length
          const start = (page - 1) * limit
          const paged = filtered.slice(start, start + limit)
          const skills = summaryOnly
            ? paged.map(({ content: _content, ...rest }) => rest)
            : paged

          return Response.json({
            skills,
            total,
            page,
            categories: KNOWN_CATEGORIES,
            profiles: profileOptions,
            activeProfile,
            selectedProfile,
            allProfilesTotal: filteredWithoutProfile.length,
          })
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          )
        }
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const capabilities = await ensureGatewayProbed()
        if (!capabilities.skills) {
          return Response.json(
            {
              ...createCapabilityUnavailablePayload('skills', {
                error: `Gateway does not support /api/skills. ${CLAUDE_UPGRADE_INSTRUCTIONS}`,
              }),
            },
            { status: 503 },
          )
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        try {
          const body = (await request.json()) as {
            action?: string
            identifier?: string
            name?: string
            category?: string
            force?: boolean
            enabled?: boolean
          }
          const action = (body.action || 'install').trim()

          let endpoint: string
          let payload: Record<string, unknown>

          if (action === 'uninstall') {
            endpoint = '/api/skills/uninstall'
            payload = { name: body.name || body.identifier || '' }
          } else if (action === 'toggle') {
            endpoint = '/api/skills/toggle'
            payload = {
              name: body.name || body.identifier || '',
              enabled: body.enabled,
            }
          } else {
            endpoint = '/api/skills/install'
            payload = {
              identifier: body.identifier || '',
              category: body.category || '',
              force: Boolean(body.force),
            }
          }

          if (capabilities.dashboard.available) {
            if (action !== 'toggle') {
              return Response.json(
                {
                  ok: false,
                  error:
                    'Skill install/uninstall is only available on the legacy enhanced fork right now. Zero-fork mode supports listing and toggling installed skills.',
                },
                { status: 501 },
              )
            }

            const response = await dashboardFetch('/api/skills/toggle', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(30_000),
            })

            const result = await response.json()
            return Response.json(result, { status: response.status })
          }

          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          }
          if (BEARER_TOKEN) headers['Authorization'] = `Bearer ${BEARER_TOKEN}`

          const response = await fetch(`${CLAUDE_API}${endpoint}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(120_000),
          })

          const result = await response.json()
          return Response.json(result, { status: response.status })
        } catch (err) {
          return Response.json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
