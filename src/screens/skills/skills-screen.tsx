'use client'

import '@/styles/matrix-skills.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'motion/react'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/toast'
import { SkillDetailDrawer } from './skill-detail-drawer'

/* ── types ── */
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
  featuredGroup?: string
  security?: SecurityRisk
  origin?: 'builtin' | 'agent-created' | 'marketplace'
}

type SkillsApiResponse = {
  skills: Array<SkillSummary>
  total: number
  page: number
  categories: Array<string>
}

type StatusFilter = 'installed' | 'marketplace' | 'all'
type ViewMode = 'grid' | 'table'
type SortMode = 'name' | 'category' | 'updated'

/* ── constants ── */
const DEFAULT_CATEGORIES = [
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
]

const ORIGIN_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All origins' },
  { value: 'builtin', label: 'Built-in' },
  { value: 'marketplace', label: 'Community' },
  { value: 'agent-created', label: 'Hermes Agent' },
  { value: 'private', label: 'Private' },
]

/* ── helpers ── */
function initials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

function scanTagClass(level?: SecurityRisk['level']): string {
  if (!level) return ''
  if (level === 'safe') return 'scan-safe'
  if (level === 'low') return 'scan-low'
  if (level === 'medium') return 'scan-med'
  return 'scan-high'
}

function relativeTime(dateStr?: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

/* ── main component ── */
export function SkillsScreen() {
  const queryClient = useQueryClient()

  /* state */
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [activeStatus, setActiveStatus] = useState<StatusFilter>('installed')
  const [activeCategory, setActiveCategory] = useState('All')
  const [activeOrigin, setActiveOrigin] = useState('all')
  const [sortMode, setSortMode] = useState<SortMode>('name')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [filtersCollapsed, setFiltersCollapsed] = useState(false)
  const [selectedSkill, setSelectedSkill] = useState<SkillSummary | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  /* debounce search */
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchQuery), 250)
    return () => clearTimeout(id)
  }, [searchQuery])

  /* data query */
  const skillsQuery = useQuery({
    queryKey: ['skills-browser', activeStatus, debouncedSearch, activeCategory, activeOrigin, sortMode],
    queryFn: async (): Promise<SkillsApiResponse> => {
      const params = new URLSearchParams()
      params.set('tab', activeStatus === 'all' ? 'installed' : activeStatus)
      params.set('limit', '200')
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (activeCategory !== 'All') params.set('category', activeCategory)
      if (activeOrigin !== 'all') params.set('origin', activeOrigin)
      params.set('sort', sortMode)

      const res = await fetch(`/api/skills?${params.toString()}`)
      const payload = (await res.json()) as SkillsApiResponse & { error?: string }
      if (!res.ok) throw new Error(payload.error || 'Failed to fetch skills')
      return payload
    },
    refetchInterval: 30_000,
  })

  const skills = skillsQuery.data?.skills ?? []
  const total = skillsQuery.data?.total ?? 0
  const enabledCount = skills.filter((s) => s.enabled).length
  const categories = skillsQuery.data?.categories ?? []

  /* category counts */
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { All: skills.length }
    for (const s of skills) {
      counts[s.category] = (counts[s.category] || 0) + 1
    }
    return counts
  }, [skills])

  /* origin counts */
  const originCounts = useMemo(() => {
    const counts: Record<string, number> = { all: skills.length }
    for (const s of skills) {
      const key = s.origin || 'unknown'
      counts[key] = (counts[key] || 0) + 1
    }
    return counts
  }, [skills])

  /* sorted skills */
  const sortedSkills = useMemo(() => {
    const list = [...skills]
    if (sortMode === 'name') list.sort((a, b) => a.name.localeCompare(b.name))
    else if (sortMode === 'category') list.sort((a, b) => a.category.localeCompare(b.category))
    return list
  }, [skills, sortMode])

  /* toggle mutation */
  const toggleMutation = useMutation({
    mutationFn: async ({ skillId, enabled }: { skillId: string; enabled: boolean }) => {
      const res = await fetch('/api/skills/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', skillId, name: skillId, identifier: skillId, enabled }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error || 'Toggle failed')
      }
      return res.json() as Promise<unknown>
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['skills-browser'] })
    },
    onError: (e) => {
      toast(e instanceof Error ? e.message : 'Toggle failed', { type: 'error' })
    },
  })

  /* handlers */
  const openDrawer = useCallback((skill: SkillSummary) => {
    setSelectedSkill(skill)
    setDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    // delay clearing so exit animation can play
    setTimeout(() => setSelectedSkill(null), 200)
  }, [])

  const handleToggle = useCallback(
    (skillId: string, enabled: boolean) => {
      toggleMutation.mutate({ skillId, enabled })
    },
    [toggleMutation],
  )

  /* relative-time ticker */
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  /* all categories merged with defaults */
  const mergedCategories = useMemo(() => {
    const fromApi = categories.filter((c) => c && c !== 'All')
    const fromDefaults = DEFAULT_CATEGORIES.filter((c) => c !== 'All')
    const set = new Set([...fromApi, ...fromDefaults])
    return ['All', ...Array.from(set).sort()]
  }, [categories])

  return (
    <div className="min-h-full bg-surface text-ink sk-shell" data-screen="skills">
      {/* ── Column 2: Filter Panel ── */}
      <aside className={cn('sk-filter', filtersCollapsed && 'collapsed')}>
        {/* header */}
        <div className="sk-filter-hdr">
          <h2>Skills</h2>
          <span className="ct">{total}</span>
          <button
            type="button"
            className="collapse-btn"
            onClick={() => setFiltersCollapsed((v) => !v)}
            title={filtersCollapsed ? 'Expand filters' : 'Collapse filters'}
            aria-label={filtersCollapsed ? 'Expand filters' : 'Collapse filters'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              {filtersCollapsed ? (
                <path d="M9 18l6-6-6-6" />
              ) : (
                <path d="M15 18l-6-6 6-6" />
              )}
            </svg>
          </button>
        </div>

        {/* search */}
        <div className="sk-filter-search">
          <input
            type="text"
            placeholder="Search skills…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search skills"
          />
        </div>

        {/* body */}
        <div className="sk-filter-body">
          {/* status segment */}
          <div className="sk-filter-section">
            <div className="sec-label">Status</div>
            <div className="sk-segment">
              <button
                type="button"
                className={cn(activeStatus === 'installed' && 'active')}
                onClick={() => setActiveStatus('installed')}
              >
                Installed
                {total > 0 && <span style={{ marginLeft: 4, fontSize: 9, opacity: .7 }}>{total}</span>}
              </button>
              <button
                type="button"
                className={cn(activeStatus === 'marketplace' && 'active')}
                onClick={() => setActiveStatus('marketplace')}
              >
                Hub
              </button>
              <button
                type="button"
                className={cn(activeStatus === 'all' && 'active')}
                onClick={() => setActiveStatus('all')}
              >
                All
              </button>
            </div>
          </div>

          {/* category filter */}
          <div className="sk-filter-section">
            <div className="sec-label">Category</div>
            <div className="sk-filter-list">
              {mergedCategories.slice(0, 12).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={cn('sk-filter-item', activeCategory === cat && 'active')}
                  onClick={() => setActiveCategory(cat)}
                >
                  <span>{cat}</span>
                  <span className="item-ct">{categoryCounts[cat] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          {/* origin filter */}
          <div className="sk-filter-section">
            <div className="sec-label">Origin</div>
            <div className="sk-filter-list">
              {ORIGIN_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={cn('sk-filter-item', activeOrigin === opt.value && 'active')}
                  onClick={() => setActiveOrigin(opt.value)}
                >
                  <span>{opt.label}</span>
                  <span className="item-ct">{originCounts[opt.value] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* collapsed rail */}
        <div className="sk-rail">
          <span className="rail-label">Skills</span>
          <span className="rail-badge">{total}</span>
        </div>
      </aside>

      {/* ── Column 3: Main area ── */}
      <div className="sk-main">
        {/* top strip */}
        <div className="sk-top">
          <div className="crumbs">
            <div className="title-group">
              <h1>Skills</h1>
              <span className="sub">Workspace / Knowledge / Skills</span>
            </div>
          </div>
          <div className="meta">
            <div className="stat">
              <span className="v">{total}</span>
              <span className="l">Total</span>
            </div>
            <div className="stat">
              <span className="v ok">{enabledCount}</span>
              <span className="l">Enabled</span>
            </div>
          </div>
        </div>

        {/* toolbar */}
        <div className="sk-toolbar">
          <span className="result-ct">
            {sortedSkills.length} result{sortedSkills.length !== 1 ? 's' : ''}
          </span>
          <div className="toolbar-right">
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              aria-label="Sort skills"
            >
              <option value="name">Name A–Z</option>
              <option value="category">Category</option>
              <option value="updated">Updated</option>
            </select>

            <div className="sk-view-toggle">
              <button
                type="button"
                className={cn(viewMode === 'grid' && 'active')}
                onClick={() => setViewMode('grid')}
                title="Grid view"
                aria-label="Grid view"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              </button>
              <button
                type="button"
                className={cn(viewMode === 'table' && 'active')}
                onClick={() => setViewMode('table')}
                title="Table view"
                aria-label="Table view"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M3 6h18M3 12h18M3 18h18" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* canvas */}
        <div className="sk-canvas">
          {skillsQuery.isPending ? (
            <div className="sk-grid">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="sk-skeleton" />
              ))}
            </div>
          ) : sortedSkills.length === 0 ? (
            <div className="sk-empty">
              <div className="empty-icon">🧩</div>
              <h3>No skills found</h3>
              <p>
                {debouncedSearch
                  ? 'Try adjusting your search or filters.'
                  : 'Install skills from the Hub or create your own.'}
              </p>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="sk-grid">
              {sortedSkills.map((skill) => (
                <article
                  key={skill.id}
                  className="sk-card"
                  style={{
                    '--card-accent':
                      skill.installed
                        ? skill.enabled
                          ? 'var(--m-green-500, #00ff41)'
                          : 'var(--m-text-ghost, #555)'
                        : '#00d4ff',
                  } as React.CSSProperties}
                  onClick={() => openDrawer(skill)}
                >
                  <div className="sk-card-body">
                    <div className="sk-glyph">{initials(skill.name)}</div>
                    <div className="sk-card-info">
                      <p className="name">{skill.name}</p>
                      <p className="author">{skill.author}</p>
                    </div>
                  </div>
                  <p className="sk-card-desc">{skill.description}</p>
                  <div className="sk-card-tags">
                    <span className="sk-tag cat">{skill.category}</span>
                    {skill.origin && skill.origin !== 'marketplace' && (
                      <span className="sk-tag origin">
                        {skill.origin === 'builtin' ? 'Built-in' : skill.origin === 'agent-created' ? 'Hermes Agent' : skill.origin}
                      </span>
                    )}
                    {skill.security && (
                      <span className={cn('sk-tag', scanTagClass(skill.security.level))}>
                        {skill.security.level}
                      </span>
                    )}
                    {skill.origin === 'builtin' && !skill.security && (
                      <span className="sk-tag builtin">builtin</span>
                    )}
                  </div>
                  <div className="sk-card-meta">
                    <div className="meta-left">
                      <span>v1.0</span>
                      <span>•</span>
                      <span>Updated recently</span>
                    </div>
                    <button
                      type="button"
                      className={cn('sk-toggle', skill.enabled && 'on')}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleToggle(skill.id, !skill.enabled)
                      }}
                      aria-label={skill.enabled ? 'Disable skill' : 'Enable skill'}
                    >
                      <span className="knob" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            /* table view */
            <table className="sk-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Origin</th>
                  <th>Security</th>
                  <th>Status</th>
                  <th style={{ width: 50 }}>Enabled</th>
                </tr>
              </thead>
              <tbody>
                {sortedSkills.map((skill) => (
                  <tr
                    key={skill.id}
                    style={{
                      '--row-accent':
                        skill.installed
                          ? skill.enabled
                            ? 'var(--m-green-500, #00ff41)'
                            : 'var(--m-text-ghost, #555)'
                          : '#00d4ff',
                    } as React.CSSProperties}
                    onClick={() => openDrawer(skill)}
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="sk-glyph" style={{ width: 28, height: 28, fontSize: 10 }}>
                          {initials(skill.name)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>{skill.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--m-text-faint, var(--theme-muted))' }}>
                            {skill.author}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{skill.category}</td>
                    <td style={{ textTransform: 'capitalize' }}>
                      {skill.origin === 'agent-created' ? 'Hermes Agent' : skill.origin || '—'}
                    </td>
                    <td>
                      {skill.security ? (
                        <span
                          className={cn('sk-tag', scanTagClass(skill.security.level))}
                          style={{ fontSize: 9 }}
                        >
                          {skill.security.level}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {skill.installed ? (skill.enabled ? 'Active' : 'Disabled') : 'Not installed'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={cn('sk-toggle', skill.enabled && 'on')}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleToggle(skill.id, !skill.enabled)
                        }}
                        aria-label={skill.enabled ? 'Disable skill' : 'Enable skill'}
                      >
                        <span className="knob" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Detail Drawer ── */}
      <AnimatePresence>
        {drawerOpen && selectedSkill && (
          <SkillDetailDrawer
            skill={selectedSkill}
            onClose={closeDrawer}
            onToggle={handleToggle}
            toggling={toggleMutation.isPending}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
