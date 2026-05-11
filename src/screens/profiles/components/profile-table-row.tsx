import type { AgentRow } from '../profiles-screen'

type Props = {
  agent: AgentRow
  onClick: () => void
}

export function ProfileTableRow({ agent, onClick }: Props) {
  const builtinClass = agent.builtin ? ' builtin' : ''
  const tierKey = `t${String(agent.tier)}` as 't1' | 't2' | 't3'

  return (
    <tr className={builtinClass} onClick={onClick}>
      {/* Agent name + glyph */}
      <td>
        <div className="pf-tbl-name">
          <div className={`pf-glyph pf-glyph-sm${agent.tier === 2 ? ' tier-2-glyph' : ''}`}>
            {agent.glyph}
          </div>
          <div>
            <b>{agent.name}</b>
            <div className="role">{agent.role}</div>
          </div>
        </div>
      </td>

      {/* Tier */}
      <td>
        <span className={`pill-tier ${tierKey}`}>T{agent.tier}</span>
      </td>

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
