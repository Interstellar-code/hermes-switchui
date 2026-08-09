import type { AgentRow } from '../profiles-screen'
import type { ProfileReachability } from '@/hooks/use-profile-scope-status'
import { formatRelative } from '@/lib/format'
import { useProfileScopeStatus } from '@/hooks/use-profile-scope-status'

type Props = {
  agent: AgentRow
  /** Opens the detail drawer. Editing is a separate, explicit action (G-01). */
  onOpen: () => void
  onActivate?: (profileName: string) => void
  onEdit?: (agent: AgentRow) => void
  onClone?: (agent: AgentRow) => void
  onDelete?: (profileName: string) => void
  'data-profile'?: string
}

function GlyphEl({ glyph, tier }: { glyph: string; tier: 1 | 2 | 3 }) {
  return (
    <div className={`pf-glyph${tier === 1 || tier === 2 ? ` tier-${tier}-glyph` : ''}`}>
      {glyph}
    </div>
  )
}

/**
 * G-05: whether the *live* gateway can actually reach this profile right
 * now — independent of, and complementary to, `StatusDot` (which reflects
 * this workspace's own `active_profile` pointer, not gateway topology).
 * Quiet by design: `useProfileScopeStatus` only returns a value other than
 * `'served'` when it is actionable (multiplex gateway that excludes this
 * profile, a single gateway serving a DIFFERENT profile, or the probe failed
 * closed), so most cards render nothing here. See `use-profile-scope-status.ts`
 * for the full semantics.
 */
function ScopeBadge({
  reachability,
  mode,
  servingProfile,
}: {
  reachability: ProfileReachability
  mode: 'single' | 'multiplex' | 'unknown' | null
  servingProfile: string | null
}) {
  if (reachability === 'served') return null
  const unknown = reachability === 'unknown'
  const notServedTitle =
    mode === 'single'
      ? `Not currently served — the running gateway is serving ${
          servingProfile ? `"${servingProfile}"` : 'a different profile'
        } instead of this one. Restart the gateway (or select the profile it's already running) to reach this one.`
      : 'Not served by the live gateway — this profile is not in its multiplexed profile list, so activating it will not respond to chats until the gateway config is updated.'
  return (
    <span
      className={`pf-scope-badge ${unknown ? 'pf-scope-badge--unknown' : 'pf-scope-badge--not-served'}`}
      title={
        unknown
          ? 'Gateway reachability unknown — the topology probe failed, so this cannot be confirmed as servable.'
          : notServedTitle
      }
    >
      {unknown ? 'unknown' : 'not served'}
    </span>
  )
}

/**
 * The one honest state indicator (P-06).
 *
 * The card used to render this dot *and* a separate "⚡ IN USE" badge driven by
 * `p.active`. Now that `status` is derived from `~/.hermes/active_profile`,
 * `status === 'active'` and "in use" are the same fact stated twice, so the
 * badge is gone and the dot carries it.
 */
function StatusDot({ status }: { status: AgentRow['status'] }) {
  return (
    <div
      className={`pf-status ${status}`}
      title={
        status === 'active'
          ? 'Currently selected profile — the gateway runs this config'
          : status === 'idle'
            ? 'Has run before, but is not the selected profile'
            : 'Never run'
      }
    >
      <div className="d" />
      {status === 'active' ? 'in use' : status}
    </div>
  )
}

export function ProfileCard({
  agent,
  onOpen,
  onActivate,
  onEdit,
  onClone,
  onDelete,
  'data-profile': dataProfile,
}: Props) {
  const tierClass = `tier-${agent.tier}`
  const builtinClass = agent.builtin ? ' builtin' : ''
  const isActive = agent.status === 'active'
  const inUseClass = isActive ? ' pf-card--in-use' : ''
  const lastUsed = agent.lastRunAt !== null ? formatRelative(agent.lastRunAt) : 'never run'
  const hasActions = Boolean(onActivate ?? onEdit ?? onClone ?? onDelete)
  const { reachability, mode, servingProfile } = useProfileScopeStatus(agent.profileName)

  return (
    <article
      className={`pf-card ${tierClass}${builtinClass}${inUseClass}`}
      // P-16: the card carries the primary action, so it has to be reachable and
      // operable from the keyboard. `role="button"` deliberately replaces the
      // implicit `article` role — this is a control, not a document section.
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          // Only when the card itself is focused; nested buttons handle their own
          // keys and their activation already bubbles a click we stop below.
          if (e.target !== e.currentTarget) return
          e.preventDefault()
          onOpen()
        }
      }}
      aria-label={`${agent.name} — ${agent.role} — Tier ${agent.tier} — ${agent.status}. Open details.`}
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
        <ScopeBadge reachability={reachability} mode={mode} servingProfile={servingProfile} />
        {agent.builtin && (
          <span className="pf-lock-badge" title="Built-in agent — editable and cloneable, but it cannot be renamed or deleted">
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

      {/* Meta: model badge + tags */}
      <div className="pf-card-meta">
        {agent.model && <span className="pf-model-badge">{agent.model}</span>}
        {agent.tags.slice(0, 3).map((t) => (
          <span key={t} className="pf-tag">{t}</span>
        ))}
      </div>

      {/* Signals the list API already returns but nothing used to show (G-02) */}
      <div className="pf-card-stats">
        <span className="pf-stat" title={`${String(agent.skillCount)} skill file(s) in skills/`}>
          {agent.skillCount} {agent.skillCount === 1 ? 'skill' : 'skills'}
        </span>
        <span className="pf-stat" title={`${String(agent.sessionCount)} session file(s) in sessions/`}>
          {agent.sessionCount} {agent.sessionCount === 1 ? 'session' : 'sessions'}
        </span>
        <span className="pf-last-run" title={
          agent.lastRunAt !== null
            ? new Date(agent.lastRunAt * 1000).toLocaleString()
            : 'This profile has no sessions on disk'
        }>
          {lastUsed}
        </span>
        {agent.hasEnv && (
          <span className="pf-env-badge" title="This profile has its own .env file">.env</span>
        )}
      </div>

      {/* Action buttons — the screen withholds any callback the server would reject */}
      {hasActions && (
        <div
          className="pf-card-actions"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
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
        </div>
      )}
    </article>
  )
}
