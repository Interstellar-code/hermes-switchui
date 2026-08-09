import type { AgentRow } from '../profiles-screen'
import { formatRelative } from '@/lib/format'
import { useProfileScopeStatus } from '@/hooks/use-profile-scope-status'

type Props = {
  agent: AgentRow
  /** Opens the detail drawer. Editing is a separate, explicit action (G-01). */
  onOpen: () => void
  onActivate?: (profileName: string) => void
  onEdit?: (agent: AgentRow) => void
  onRename?: (agent: AgentRow) => void
  onDelete?: (profileName: string) => void
  onClone?: (agent: AgentRow) => void
}

export function ProfileTableRow({
  agent,
  onOpen,
  onActivate,
  onEdit,
  onRename,
  onDelete,
  onClone,
}: Props) {
  const builtinClass = agent.builtin ? ' builtin' : ''
  const tierKey = `t${String(agent.tier)}` as 't1' | 't2' | 't3'
  const hasActions = Boolean(onActivate ?? onEdit ?? onRename ?? onClone ?? onDelete)
  // P-07: rename/delete are withheld for built-ins because the server answers
  // `Profile name "x" is reserved for built-in agents` (403). Say so instead of
  // rendering buttons that are guaranteed to fail.
  const lockTitle = agent.builtin
    ? 'Built-in agent — it can be edited and cloned, but not renamed or deleted'
    : 'Built-in agent — cannot be modified'
  // G-05: live-gateway reachability, independent of the `status` column
  // (which reflects this workspace's `active_profile` pointer, not gateway
  // topology). See use-profile-scope-status.ts for the full semantics.
  const { reachability, mode, servingProfile } = useProfileScopeStatus(agent.profileName)
  const notServedTitle =
    mode === 'single'
      ? `Not currently served — the running gateway is serving ${
          servingProfile ? `"${servingProfile}"` : 'a different profile'
        } instead of this one. Restart the gateway (or select the profile it's already running) to reach this one.`
      : 'Not served by the live gateway — this profile is not in its multiplexed profile list, so activating it will not respond to chats until the gateway config is updated.'

  return (
    <tr
      className={`pf-tbl-row${builtinClass}`}
      data-profile={agent.name}
      // P-16: `<tr>` already has the implicit `row` role — overriding it would
      // break the table's semantics — so keyboard access comes from making the
      // row focusable and giving it an Enter/Space handler, matching the
      // toolset tiles in wizard-step-toolset.tsx.
      tabIndex={0}
      aria-label={`${agent.name} — ${agent.role} — Tier ${agent.tier} — ${agent.status}. Open details.`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target !== e.currentTarget) return
          e.preventDefault()
          onOpen()
        }
      }}
    >
      {/* Agent name + glyph */}
      <td>
        <div className="pf-tbl-name">
          <div
            className={`pf-glyph pf-glyph-sm${agent.tier === 1 || agent.tier === 2 ? ` tier-${agent.tier}-glyph` : ''}`}
          >
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

      {/* Status — derived server-side (P-06) */}
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className={`pf-status ${agent.status}`}>
            <div className="d" />
            {agent.status === 'active' ? 'in use' : agent.status}
          </div>
          {reachability !== 'served' && (
            <span
              className={`pf-scope-badge ${reachability === 'unknown' ? 'pf-scope-badge--unknown' : 'pf-scope-badge--not-served'}`}
              title={
                reachability === 'unknown'
                  ? 'Gateway reachability unknown — the topology probe failed, so this cannot be confirmed as servable.'
                  : notServedTitle
              }
            >
              {reachability === 'unknown' ? 'unknown' : 'not served'}
            </span>
          )}
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

      {/* Last used — P-12, unix seconds */}
      <td style={{ whiteSpace: 'nowrap', opacity: 0.6 }}>
        {agent.lastRunAt !== null ? formatRelative(agent.lastRunAt) : '—'}
      </td>

      {/* Actions */}
      <td
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {!hasActions ? (
          <span className="pf-tbl-lock" title={lockTitle}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13" style={{ opacity: 0.3 }}>
              <rect x="3" y="7" width="10" height="8" rx="1.5"/>
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>
            </svg>
          </span>
        ) : (
          <div className="pf-tbl-actions">
            {onActivate && (
              <button
                type="button"
                className="pf-tbl-action-btn pf-tbl-action-btn--primary"
                title="Activate — make this the profile the gateway runs"
                aria-label={`Activate ${agent.name}`}
                onClick={() => onActivate(agent.profileName!)}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13">
                  <circle cx="8" cy="8" r="6.5"/>
                  <path d="M6 8l2 2 3-3"/>
                </svg>
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                className="pf-tbl-action-btn"
                title="Edit"
                aria-label={`Edit ${agent.name}`}
                onClick={() => onEdit(agent)}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13">
                  <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H3v-2L11.5 2.5z"/>
                </svg>
              </button>
            )}
            {onRename && (
              <button
                type="button"
                className="pf-tbl-action-btn"
                title="Rename"
                aria-label={`Rename ${agent.name}`}
                onClick={() => onRename(agent)}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13">
                  <path d="M4 3h8M8 3v10M6 13h4"/>
                </svg>
              </button>
            )}
            {onClone && (
              <button
                type="button"
                className="pf-tbl-action-btn"
                title="Clone"
                aria-label={`Clone ${agent.name}`}
                onClick={() => onClone(agent)}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13">
                  <rect x="5" y="5" width="8" height="9" rx="1.5"/>
                  <path d="M3 11V3a1 1 0 0 1 1-1h8"/>
                </svg>
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="pf-tbl-action-btn pf-tbl-action-btn--danger"
                title="Delete"
                aria-label={`Delete ${agent.name}`}
                onClick={() => onDelete(agent.profileName!)}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13">
                  <path d="M3 4h10M6 4V2.5h4V4M5 4v9h6V4"/>
                </svg>
              </button>
            )}
            {agent.builtin && (
              <span className="pf-tbl-lock" title={lockTitle}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13" style={{ opacity: 0.3 }}>
                  <rect x="3" y="7" width="10" height="8" rx="1.5"/>
                  <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>
                </svg>
              </span>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}
