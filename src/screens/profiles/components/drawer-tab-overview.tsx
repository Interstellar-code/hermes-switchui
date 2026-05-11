import { useEffect, useState } from 'react'
import type { AgentRow } from '../profiles-screen'
import type { AgentUIMetadata } from '@/server/profiles-browser'
import { GlyphPicker } from './glyph-picker'

type Props = {
  agent: AgentRow
  description: string
  readonly: boolean
  onSave: (patch: { description?: string; agent_ui?: Partial<AgentUIMetadata> }) => Promise<void>
  onActivate?: () => void
  onRename?: () => void
  onDelete?: () => void
  onUpgradeLegacy?: () => Promise<void>
  isLegacy: boolean
}

export function DrawerTabOverview({
  agent,
  description,
  readonly,
  onSave,
  onActivate,
  onRename,
  onDelete,
  onUpgradeLegacy,
  isLegacy,
}: Props) {
  const [role, setRole] = useState(agent.role === '—' ? '' : agent.role)
  const [desc, setDesc] = useState(description)
  const [glyph, setGlyph] = useState(agent.glyph ?? '')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>(agent.tags)
  const [busy, setBusy] = useState(false)
  const [upgradeBusy, setUpgradeBusy] = useState(false)

  // B9: resync local state when agent prop changes after refetch
  useEffect(() => {
    setRole(agent.role === '—' ? '' : agent.role)
    setGlyph(agent.glyph ?? '')
    setTags(agent.tags)
  }, [agent])

  useEffect(() => {
    setDesc(description)
  }, [description])

  const dirty =
    (role !== (agent.role === '—' ? '' : agent.role)) ||
    desc !== description ||
    glyph !== (agent.glyph ?? '') ||
    JSON.stringify(tags) !== JSON.stringify(agent.tags)

  async function handleSave() {
    setBusy(true)
    try {
      await onSave({
        description: desc || undefined,
        agent_ui: { role: role || undefined, glyph: glyph || undefined, tags },
      })
    } finally {
      setBusy(false)
    }
  }

  function addTag() {
    const t = tagInput.trim().toLowerCase()
    if (t && !tags.includes(t)) setTags([...tags, t])
    setTagInput('')
  }

  function removeTag(t: string) {
    setTags(tags.filter((x) => x !== t))
  }

  async function handleUpgrade() {
    if (!onUpgradeLegacy) return
    setUpgradeBusy(true)
    try {
      await onUpgradeLegacy()
    } finally {
      setUpgradeBusy(false)
    }
  }

  const statusColors: Record<string, string> = {
    active: '#00ff41',
    idle: '#888',
    draft: '#f59e0b',
  }

  return (
    <div>
      {/* Legacy upgrade banner */}
      {isLegacy && (
        <div className="pf-drawer-banner">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M8 1.5L14.5 13H1.5L8 1.5z"/>
            <line x1="8" y1="6" x2="8" y2="9.5"/>
            <circle cx="8" cy="11.5" r=".6" fill="currentColor" stroke="none"/>
          </svg>
          <div className="pf-drawer-banner-body">
            <div className="pf-drawer-banner-title">Legacy profile — upgrade?</div>
            This profile has no <code>agent_ui</code> block. Upgrade adds display
            metadata (glyph, role, tags) without touching existing config.
          </div>
          {!readonly && onUpgradeLegacy && (
            <button
              type="button"
              className="pf-drawer-banner-btn"
              onClick={() => void handleUpgrade()}
              disabled={upgradeBusy}
            >
              {upgradeBusy ? 'Upgrading…' : 'Upgrade'}
            </button>
          )}
        </div>
      )}

      {/* Read-only notice */}
      {readonly && (
        <div className="pf-drawer-readonly-notice">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
            <rect x="3" y="7" width="10" height="8" rx="2"/>
            <path d="M5 7V5a3 3 0 0 1 6 0v2"/>
          </svg>
          Read-only — built-in agents cannot be modified
        </div>
      )}

      {/* Field grid */}
      <div className="pf-drawer-field-grid">
        <div className="pf-drawer-field">
          <div className="pf-drawer-field-label">ID</div>
          <div className="pf-drawer-field-value" style={{ fontFamily: 'monospace', fontSize: 11 }}>{agent.profileName ?? agent.id}</div>
        </div>
        <div className="pf-drawer-field">
          <div className="pf-drawer-field-label">Tier</div>
          <div className="pf-drawer-field-value">
            <span style={{ background: agent.tier === 1 ? '#00ff41' : agent.tier === 2 ? '#5c8aff' : 'rgba(0,255,65,.12)', color: agent.tier === 1 ? '#000' : agent.tier === 2 ? '#fff' : 'var(--m-green-500,#00ff41)', borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', fontFamily: 'monospace' }}>
              T{agent.tier}
            </span>
          </div>
        </div>
        <div className="pf-drawer-field">
          <div className="pf-drawer-field-label">Status</div>
          <div className="pf-drawer-field-value">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: 'monospace' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColors[agent.status] ?? '#888', display: 'inline-block', flexShrink: 0 }} />
              {agent.status}
            </span>
          </div>
        </div>
        {agent.model && (
          <div className="pf-drawer-field">
            <div className="pf-drawer-field-label">Model</div>
            <div className="pf-drawer-field-value" style={{ fontSize: 11 }}>{agent.model}</div>
          </div>
        )}
        <div className="pf-drawer-field">
          <div className="pf-drawer-field-label">Last Run</div>
          <div className="pf-drawer-field-value" style={{ fontSize: 11 }}>
            {agent.last_run ? new Date(agent.last_run * 1000).toLocaleString() : '—'}
          </div>
        </div>
      </div>

      {/* Editable: description */}
      <div style={{ marginBottom: 16 }}>
        <p className="pf-drawer-section-title">Description</p>
        <input
          className="pf-drawer-input"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Short description of this agent"
          disabled={readonly}
          maxLength={160}
        />
      </div>

      {/* Editable: role */}
      <div style={{ marginBottom: 16 }}>
        <p className="pf-drawer-section-title">Role</p>
        <input
          className="pf-drawer-input"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="e.g. TypeScript Architect"
          disabled={readonly}
          maxLength={80}
        />
      </div>

      {/* Editable: glyph */}
      {!isLegacy && (
        <div style={{ marginBottom: 16 }}>
          <p className="pf-drawer-section-title">Glyph</p>
          {readonly ? (
            <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700 }}>{glyph || '—'}</span>
          ) : (
            <GlyphPicker value={glyph} onChange={setGlyph} name={agent.name} role={role} />
          )}
        </div>
      )}

      {/* Editable: tags */}
      <div style={{ marginBottom: 20 }}>
        <p className="pf-drawer-section-title">Tags</p>
        {tags.length > 0 && (
          <div className="pf-drawer-tags-row">
            {tags.map((t) => (
              <span key={t} className="pf-drawer-tag-chip">
                {t}
                {!readonly && (
                  <button type="button" onClick={() => removeTag(t)} aria-label={`Remove tag ${t}`}>
                    <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/>
                    </svg>
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        {!readonly && (
          <div className="pf-drawer-tags-add">
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
              placeholder="Add tag…"
              maxLength={32}
            />
            <button type="button" className="pf-drawer-action-btn primary" onClick={addTag} disabled={!tagInput.trim()}>
              Add
            </button>
          </div>
        )}
      </div>

      {/* Save row */}
      {!readonly && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <button
            type="button"
            className="pf-drawer-btn-save"
            onClick={() => void handleSave()}
            disabled={!dirty || busy}
          >
            {busy ? 'Saving…' : 'Save Changes'}
          </button>
          {dirty && (
            <button
              type="button"
              className="pf-drawer-btn-cancel"
              onClick={() => { setRole(agent.role === '—' ? '' : agent.role); setDesc(description); setGlyph(agent.glyph ?? ''); setTags(agent.tags) }}
            >
              Reset
            </button>
          )}
        </div>
      )}

      {/* Action buttons */}
      {!readonly && (
        <div>
          <p className="pf-drawer-section-title">Actions</p>
          <div className="pf-drawer-actions">
            {onActivate && !agent.active && (
              <button type="button" className="pf-drawer-action-btn primary" onClick={onActivate}>
                Activate
              </button>
            )}
            {onRename && (
              <button type="button" className="pf-drawer-action-btn" onClick={onRename}>
                Rename
              </button>
            )}
            {onDelete && agent.tier === 3 && agent.profileName !== 'default' && (
              <button type="button" className="pf-drawer-action-btn danger" onClick={onDelete}>
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
