import type { AgentRow } from '../profiles-screen'

type Props = {
  agent: AgentRow
  onClick: () => void
  onActivate?: (profileName: string) => void
  onRename?: (agent: AgentRow) => void
  onDelete?: (profileName: string) => void
}

// POL-03: built-in T1/T2 and default (active without profileName) are protected
function isProtected(agent: AgentRow): boolean {
  return agent.builtin || (agent.active === true && !agent.profileName)
}

export function ProfileTableRow({ agent, onClick, onActivate, onRename, onDelete }: Props) {
  const builtinClass = agent.builtin ? ' builtin' : ''
  const tierKey = `t${String(agent.tier)}` as 't1' | 't2' | 't3'
  const protected_ = isProtected(agent)

  return (
    <tr className={builtinClass} data-profile={agent.name} onClick={onClick}>
      {/* Agent name + glyph */}
      <td>
        <div className="pf-tbl-name">
          <div className={`pf-glyph pf-glyph-sm${agent.tier === 2 ? ' tier-2-glyph' : ''}`}>
            {agent.glyph}
          </div>
          <div>
            <b>{agent.name}</b>
          </div>
        </div>
      </td>

      {/* Tier */}
      <td>
        <span className={`pill-tier ${tierKey}`}>T{agent.tier}</span>
      </td>

      {/* Role */}
      <td style={{ opacity: 0.75, fontSize: 12 }}>{agent.role}</td>

      {/* Model */}
      <td>
        {agent.model
          ? <span className="pf-model-badge">{agent.model}</span>
          : <span style={{ opacity: 0.35 }}>—</span>}
      </td>

      {/* Status */}
      <td>
        <div className={`pf-status ${agent.status}`}>
          <div className="d" />
          {agent.status}
        </div>
      </td>

      {/* Tags */}
      <td>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {agent.tags.slice(0, 4).map((t) => (
            <span key={t} className="pf-tag">{t}</span>
          ))}
        </div>
      </td>

      {/* Last run */}
      <td style={{ whiteSpace: 'nowrap', opacity: 0.6 }}>
        {agent.last_run !== null ? formatRelative(agent.last_run) : '—'}
      </td>

      {/* Actions */}
      <td onClick={(e) => e.stopPropagation()}>
        {protected_ ? (
          <span className="pf-tbl-lock" title="Built-in agent — cannot be modified">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13" style={{ opacity: 0.3 }}>
              <rect x="3" y="7" width="10" height="8" rx="1.5"/>
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>
            </svg>
          </span>
        ) : (
          <div className="pf-tbl-actions">
            {!agent.active && agent.profileName && onActivate && (
              <button
                type="button"
                className="pf-tbl-action-btn"
                title="Activate"
                onClick={() => onActivate(agent.profileName!)}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13">
                  <circle cx="8" cy="8" r="6.5"/>
                  <path d="M6 8l2 2 3-3"/>
                </svg>
              </button>
            )}
            {agent.profileName && onRename && (
              <button
                type="button"
                className="pf-tbl-action-btn"
                title="Rename"
                onClick={() => onRename(agent)}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13">
                  <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H3v-2L11.5 2.5z"/>
                </svg>
              </button>
            )}
            {agent.profileName && onDelete && (
              <button
                type="button"
                className="pf-tbl-action-btn pf-tbl-action-btn--danger"
                title="Delete"
                onClick={() => onDelete(agent.profileName!)}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13">
                  <path d="M3 4h10M6 4V2.5h4V4M5 4v9h6V4"/>
                </svg>
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}

function formatRelative(ts: number): string {
  const diff = Math.floor((Date.now() / 1000) - ts)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${String(Math.floor(diff / 60))}m ago`
  if (diff < 86400) return `${String(Math.floor(diff / 3600))}h ago`
  return `${String(Math.floor(diff / 86400))}d ago`
}
