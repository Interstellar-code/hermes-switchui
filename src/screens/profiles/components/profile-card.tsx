import type { AgentRow } from '../profiles-screen'

type Props = {
  agent: AgentRow
  onClick: () => void
  'data-profile'?: string
}

function GlyphEl({ glyph, tier }: { glyph: string; tier: 1 | 2 | 3 }) {
  return (
    <div className={`pf-glyph${tier === 1 || tier === 2 ? ` tier-${tier}-glyph` : ''}`}>
      {glyph}
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  return (
    <div className={`pf-status ${status}`}>
      <div className="d" />
      {status}
    </div>
  )
}

export function ProfileCard({ agent, onClick, 'data-profile': dataProfile }: Props) {
  const tierClass = `tier-${agent.tier}`
  const builtinClass = agent.builtin ? ' builtin' : ''

  return (
    <article
      className={`pf-card ${tierClass}${builtinClass}`}
      onClick={onClick}
      aria-label={`${agent.name} — ${agent.role} — Tier ${agent.tier} — ${agent.status}`}
      data-profile={dataProfile}
    >
      {/* Head: glyph + name/role + tier badge */}
      <div className="pf-card-head">
        <GlyphEl glyph={agent.glyph} tier={agent.tier} />
        <div style={{ minWidth: 0 }}>
          <div className="pf-card-name">{agent.name}</div>
          <div className="pf-card-role">{agent.role}</div>
        </div>
        <div className="pf-card-tier">T{agent.tier}</div>
      </div>

      {/* Status row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <StatusDot status={agent.status} />
        {agent.builtin && (
          <span className="pf-lock-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            Built-in
          </span>
        )}
      </div>

      {/* Description */}
      <div className="pf-card-desc">
        {agent.description || <span style={{ opacity: 0.4 }}>No description</span>}
      </div>

      {/* Meta: model badge, tags, last run */}
      <div className="pf-card-meta">
        {agent.model && <span className="pf-model-badge">{agent.model}</span>}
        {agent.tags.slice(0, 3).map((t) => (
          <span key={t} className="pf-tag">{t}</span>
        ))}
        <span className="pf-last-run">
          {agent.last_run ? formatRelative(agent.last_run) : '—'}
        </span>
      </div>
    </article>
  )
}

function formatRelative(ts: number): string {
  const diff = Math.floor((Date.now() / 1000) - ts)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
