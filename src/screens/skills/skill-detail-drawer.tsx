'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { writeTextToClipboard } from '@/lib/clipboard'
import { toast } from '@/components/ui/toast'

/* ── types (mirrored from skills-screen) ── */
type SecurityRisk = {
  level: 'safe' | 'low' | 'medium' | 'high'
  flags: Array<string>
  score: number
}

export type SkillSummary = {
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

type DrawerTab = 'overview' | 'source' | 'files' | 'usage'

type SkillDetailDrawerProps = {
  skill: SkillSummary
  onClose: () => void
  onToggle: (skillId: string, enabled: boolean) => void
  toggling: boolean
}

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

function secLevelColor(level: SecurityRisk['level']): string {
  if (level === 'safe') return 'safe'
  if (level === 'low') return 'low'
  if (level === 'medium') return 'medium'
  return 'high'
}

function secScoreClass(score: number): string {
  if (score >= 90) return 'ok'
  if (score >= 60) return 'warn'
  return 'danger'
}

/* ── source line renderer ── */
function renderSourceLines(content: string) {
  const lines = content.split('\n')
  const inFrontmatter = { current: false }
  const fmOpenSeen = { current: false }

  return lines.map((line, i) => {
    const trimmed = line.trim()
    let cls = 'md-text'

    // YAML frontmatter detection
    if (trimmed === '---') {
      if (!fmOpenSeen.current) {
        fmOpenSeen.current = true
        inFrontmatter.current = true
        cls = 'yaml-delim'
      } else {
        inFrontmatter.current = false
        cls = 'yaml-delim'
      }
    } else if (inFrontmatter.current) {
      if (trimmed.includes(':')) {
        cls = 'yaml-key'
      } else {
        cls = 'yaml-val'
      }
    } else if (trimmed.startsWith('#')) {
      cls = 'md-heading'
    } else if (trimmed.startsWith('`') || trimmed.startsWith('    ') || trimmed.startsWith('\t')) {
      cls = 'md-code'
    }

    return (
      <div key={i} className="source-line">
        <span className="ln">{i + 1}</span>
        <span className={`lc ${cls}`}>{line}</span>
      </div>
    )
  })
}

/* ── mock file list (fileCount from data, names synthesized) ── */
function buildFileList(skill: SkillSummary) {
  const base = skill.sourcePath || skill.slug
  const files: Array<{ name: string; size: string }> = [
    { name: 'SKILL.md', size: '—' },
  ]
  for (let i = 1; i < skill.fileCount; i++) {
    const ext = i % 3 === 0 ? '.json' : i % 2 === 0 ? '.ts' : '.md'
    files.push({
      name: `${base}-${i}${ext}`,
      size: `${(Math.floor(Math.random() * 8) + 1)}.${Math.floor(Math.random() * 9)}kb`,
    })
  }
  return files
}

/* ── file icon SVG ── */
function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="file-icon">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </svg>
  )
}

/* ── component ── */
export function SkillDetailDrawer({
  skill,
  onClose,
  onToggle,
  toggling,
}: SkillDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<DrawerTab>('overview')

  const fileList = useMemo(() => buildFileList(skill), [skill])
  const originLabel = skill.origin === 'builtin' ? 'Built-in' : skill.origin === 'agent-created' ? 'Hermes Agent' : skill.origin === 'marketplace' ? 'Community' : 'Unknown'

  function handleCopyPath() {
    writeTextToClipboard(skill.sourcePath)
    toast('Source path copied', { type: 'info', icon: '📋' })
  }

  return (
    <>
      {/* scrim */}
      <div className="sk-drawer-scrim" onClick={onClose} />

      {/* drawer panel */}
      <div className="sk-drawer">
        {/* header */}
        <div className="sk-drawer-hdr">
          <div className="sk-glyph">{initials(skill.name)}</div>
          <div className="hdr-info">
            <h2>{skill.name}</h2>
            <div className="hdr-meta">
              <span>{skill.author}</span>
              <span className="sep">•</span>
              <span>{skill.category}</span>
              <span className="sep">•</span>
              <span>{originLabel}</span>
              {skill.security && (
                <>
                  <span className="sep">•</span>
                  <span>{skill.security.level.toUpperCase()}</span>
                </>
              )}
            </div>
          </div>
          <div className="hdr-actions">
            <button
              type="button"
              className="sk-drawer-btn"
              onClick={handleCopyPath}
              title="Copy source path"
              aria-label="Copy source path"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
            <button
              type="button"
              className="sk-drawer-btn"
              onClick={onClose}
              title="Close"
              aria-label="Close drawer"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* tabs */}
        <div className="sk-drawer-tabs">
          <button
            type="button"
            className={cn(activeTab === 'overview' && 'active')}
            onClick={() => setActiveTab('overview')}
          >
            Overview
            {skill.security && <span className="tab-ct">4</span>}
          </button>
          <button
            type="button"
            className={cn(activeTab === 'source' && 'active')}
            onClick={() => setActiveTab('source')}
          >
            Source
            <span className="tab-ct">1</span>
          </button>
          <button
            type="button"
            className={cn(activeTab === 'files' && 'active')}
            onClick={() => setActiveTab('files')}
          >
            Files
            <span className="tab-ct">{skill.fileCount}</span>
          </button>
          <button
            type="button"
            className={cn(activeTab === 'usage' && 'active')}
            onClick={() => setActiveTab('usage')}
          >
            Usage
            <span className="tab-ct">{skill.triggers.length}</span>
          </button>
        </div>

        {/* body */}
        <div className="sk-drawer-body">
          {activeTab === 'overview' && (
            <>
              {/* stat cards */}
              <div className="sk-stat-cards">
                <div className="sk-stat-card">
                  <span className="val">{skill.fileCount}</span>
                  <span className="lbl">Files</span>
                </div>
                <div className="sk-stat-card">
                  <span
                    className={cn(
                      'val',
                      skill.security && secLevelColor(skill.security.level),
                    )}
                  >
                    {skill.security ? skill.security.level.toUpperCase() : '—'}
                  </span>
                  <span className="lbl">Security</span>
                </div>
                <div className="sk-stat-card">
                  <span
                    className={cn(
                      'val',
                      skill.security ? secScoreClass(skill.security.score) : '',
                    )}
                  >
                    {skill.security ? `${skill.security.score}%` : '—'}
                  </span>
                  <span className="lbl">Confidence</span>
                </div>
                <div className="sk-stat-card">
                  <span className="val">{skill.triggers.length}</span>
                  <span className="lbl">Triggers</span>
                </div>
              </div>

              {/* security panel */}
              {skill.security && (
                <div className="sk-security">
                  <p className="sec-title">Security Scan</p>
                  <div className="sec-row">
                    <span
                      className={cn('sec-badge', secLevelColor(skill.security.level))}
                    >
                      {skill.security.level}
                    </span>
                    <span>Confidence: {skill.security.score}%</span>
                  </div>
                  {skill.security.flags.length > 0 && (
                    <div className="sec-flags">
                      {skill.security.flags.map((flag) => (
                        <div key={flag} className="sec-flag">
                          {flag}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* trigger phrases */}
              {skill.triggers.length > 0 && (
                <>
                  <p className="sk-triggers-title">Trigger Phrases</p>
                  <div className="sk-trigger-pills">
                    {skill.triggers.map((t) => (
                      <span key={t} className="sk-trigger-pill">
                        {t}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {activeTab === 'source' && (
            <div className="sk-source">
              {renderSourceLines(
                skill.content || `# ${skill.name}\n\n${skill.description}\n\n_No source content available._`,
              )}
            </div>
          )}

          {activeTab === 'files' && (
            <div className="sk-file-list">
              {fileList.map((f) => (
                <div key={f.name} className="sk-file-item">
                  <FileIcon />
                  <span className="file-name">{f.name}</span>
                  <span className="file-size">{f.size}</span>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'usage' && (
            <div className="sk-usage-section">
              <h4>Trigger Phrases</h4>
              {skill.triggers.length > 0 ? (
                <div className="sk-trigger-pills">
                  {skill.triggers.map((t) => (
                    <span key={t} className="sk-trigger-pill">
                      {t}
                    </span>
                  ))}
                </div>
              ) : (
                <p style={{ color: 'var(--m-text-faint, var(--theme-muted))', fontSize: 12 }}>
                  No trigger phrases defined.
                </p>
              )}
            </div>
          )}
        </div>

        {/* footer */}
        <div className="sk-drawer-footer">
          <span className="path">{skill.sourcePath}</span>
          <button
            type="button"
            className={cn('sk-toggle', skill.enabled && 'on')}
            onClick={() => onToggle(skill.id, !skill.enabled)}
            disabled={toggling}
            aria-label={skill.enabled ? 'Disable skill' : 'Enable skill'}
            title={skill.enabled ? 'Disable' : 'Enable'}
          >
            <span className="knob" />
          </button>
        </div>
      </div>
    </>
  )
}
