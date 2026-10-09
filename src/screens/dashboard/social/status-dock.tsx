import type { DashboardOverview } from '@/server/dashboard-aggregator'
import {
  formatModelName,
  formatTokens,
} from '@/screens/dashboard/lib/formatters'

export type DockPeriod = 7 | 14 | 30

const PLATFORM_GLYPH: Record<string, string> = {
  api_server: '🌐',
  telegram: '✈️',
  discord: '🎮',
  whatsapp: '🟢',
  slack: '💼',
  signal: '🔵',
  matrix: '#',
  nostr: '⚡',
  imessage: '💬',
  bluebubbles: '🫧',
  mattermost: '🔷',
  feishu: '🪶',
  line: '💚',
  zalo: '⭐',
  twitch: '🎬',
  qqbot: '🐧',
  msteams: '🟦',
  irc: '#',
}

const CONNECTED_STATES = new Set(['connected', 'running', 'ok'])

function isConnected(state: string): boolean {
  return CONNECTED_STATES.has(state.toLowerCase())
}

/**
 * "beat Nm ago" / "beat Nh ago" — age of the last gateway heartbeat,
 * not uptime. The dashboard aggregator reports `lastHeartbeatAt` as
 * an ISO string from `/api/status.gateway_updated_at`. We do NOT
 * have an uptime field anywhere, so calling it "uptime" would be a
 * false label. `< 1m ago` collapses the freshest beats to a
 * single, screen-friendly chip.
 */
function formatHeartbeatAge(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (diffSec < 60) return '< 1m ago'
  const minutes = Math.floor(diffSec / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatCompact(n: number): string {
  if (!n || n <= 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

/**
 * Status dock — the sticky-bottom status bar the social dashboard
 * uses as the always-visible "10-second read" the operator needs
 * while the rest of the page scrolls. Folds in the data the legacy
 * OpsStrip, HeroMetrics, and ActiveModelKpi read so the docked
 * layout is the single source of truth for those numbers.
 *
 * Each item is a real `<a href>` so the dock is keyboard-navigable
 * and screen-reader friendly. Warning items flip to
 * `--theme-warning` per the spec.
 *
 * Number policy: every label reflects a real field. When a slice is
 * null or unavailable (e.g. `analytics.source === 'unavailable'`,
 * `logs === null`, `modelInfo === null`, no `platforms` reported),
 * the dock renders "—" rather than 0 / "0/0" / a fake uptime. The
 * "7d" / "14d" / "30d" chip reports the analytics window the
 * totals actually came from (`analytics.windowDays`), not the
 * `period` prop, so the two never disagree.
 */
export function StatusDock({
  overview,
  period,
  className,
}: {
  overview: DashboardOverview | null
  period: DockPeriod
  className?: string
}) {
  if (overview === null) {
    return (
      <footer
        className={className}
        aria-label="System status"
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 10,
          minHeight: 26,
          padding: '4px 10px',
          border: '1px solid var(--theme-border)',
          borderRadius: 6,
          background: 'var(--theme-card)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          color: 'var(--theme-muted)',
          fontSize: 10,
        }}
      >
        <span style={{ color: 'var(--theme-muted)' }}>status unavailable</span>
      </footer>
    )
  }

  // Gateway
  const status = overview.status
  const gatewayOk = status ? isConnected(status.gatewayState) : false
  // Unknown state: render "—" rather than a fake uptime number, and
  // do not paint the dot green (a gateway we haven't heard from is
  // not "ok").
  const beat = status ? formatHeartbeatAge(status.lastHeartbeatAt) : '—'
  const gatewayLabel = status
    ? gatewayOk
      ? `ok · beat ${beat}`
      : status.gatewayState
    : '—'

  // Platforms — empty list is "—" (we don't know the total), not "0/0"
  // which would falsely imply a 0-of-0 connectivity readout.
  const platforms = overview.platforms
  const connectedPlatforms = platforms.filter((p) =>
    isConnected(p.state),
  ).length
  const platformsLabel =
    platforms.length === 0 ? '—' : `${connectedPlatforms}/${platforms.length}`

  // Cron
  const cron = overview.cron
  const cronLabel = cron
    ? cron.failed > 0
      ? `${cron.failed} of ${cron.total} failing`
      : `${cron.total} ok`
    : '—'
  const cronWarn = cron ? cron.failed > 0 : false

  // Config
  const drift =
    status &&
    status.configVersion !== null &&
    status.latestConfigVersion !== null &&
    status.latestConfigVersion > status.configVersion
      ? status.latestConfigVersion - status.configVersion
      : 0
  const configLabel = drift > 0 ? `${drift} drift` : 'in sync'
  const configWarn = drift > 0

  // Logs — error count is over the log TAIL, not a time window.
  // Drop the "1h" claim from the label.
  const logs = overview.logs
  const logErrorCount = logs ? logs.errorCount : 0
  const logsLabel =
    logs === null
      ? '—'
      : logErrorCount > 0
        ? `${logErrorCount} errors in tail`
        : 'no errors in tail'
  const logsWarn = logErrorCount > 0

  // Right side: period totals + model. Distinguish "no analytics" from
  // "analytics is the unavailable stub" — the latter returns a real
  // section with source !== 'analytics' and zeroed totals; we must
  // not display those as real numbers.
  const analytics = overview.analytics
  const analyticsHasData = !!analytics && analytics.source === 'analytics'
  const tokensLabel = analyticsHasData
    ? formatTokens(analytics.totalTokens)
    : '—'
  const sessionsLabel = analyticsHasData
    ? formatCompact(analytics.totalSessions)
    : '—'
  const callsLabel = analyticsHasData
    ? formatCompact(analytics.totalApiCalls)
    : '—'
  // The window chip reports the window the totals actually came
  // from. If analytics is null/unavailable, the period prop is the
  // user's selection but doesn't describe any data — show "—".
  const windowLabel = analyticsHasData ? `${analytics.windowDays}d` : '—'

  const modelInfo = overview.modelInfo
  const modelLabel = modelInfo
    ? `${modelInfo.provider} · ${formatModelName(modelInfo.model)}`
    : '—'

  const warnStyle = { color: 'var(--theme-warning)' }
  const mutedStyle = { color: 'var(--theme-muted)' }
  const textStyle = { color: 'var(--theme-text)' }
  const dotBase = {
    width: 6,
    height: 6,
    borderRadius: '50%',
    display: 'inline-block',
  } as const

  return (
    <footer
      className={className}
      aria-label="System status"
      style={{
        position: 'sticky',
        bottom: 0,
        zIndex: 10,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '2px 14px',
        minHeight: 26,
        padding: '4px 10px',
        margin: '0 -2px',
        border: '1px solid var(--theme-border)',
        borderRadius: 6,
        background: 'var(--theme-card)',
        boxShadow: '0 -8px 20px var(--theme-bg, transparent)',
        fontSize: 9.5,
      }}
    >
      <a
        href="/operations"
        className="st"
        style={{
          ...mutedStyle,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        <span
          aria-hidden
          style={{
            ...dotBase,
            background: status
              ? gatewayOk
                ? 'var(--theme-success)'
                : 'var(--theme-warning)'
              : 'var(--theme-muted)',
          }}
        />
        gateway <b style={{ fontWeight: 400, ...textStyle }}>{gatewayLabel}</b>
      </a>
      <a
        href="/operations"
        className="st"
        style={{
          ...mutedStyle,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
        title={
          platforms.length > 0
            ? platforms
                .map(
                  (p) =>
                    `${p.name}: ${p.state}${p.errorMessage ? ` (${p.errorMessage})` : ''}`,
                )
                .join('\n')
            : 'no platforms reported'
        }
      >
        {platforms.length > 0
          ? platforms.slice(0, 4).map((p) => (
              <span
                key={p.name}
                aria-hidden
                style={{ fontSize: 9 }}
                title={`${p.name} · ${p.state}`}
              >
                {PLATFORM_GLYPH[p.name] ?? '🔌'}
              </span>
            ))
          : null}
        platforms{' '}
        <b style={{ fontWeight: 400, ...textStyle }}>{platformsLabel}</b>
      </a>
      <a
        href="/jobs"
        className="st"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          ...(cronWarn ? warnStyle : mutedStyle),
        }}
        title={
          cron
            ? cron.failed > 0
              ? `${cron.failed} failing of ${cron.total}`
              : `${cron.total} jobs running fine`
            : 'no cron jobs reported'
        }
      >
        <span
          aria-hidden
          style={{
            ...dotBase,
            background: cronWarn
              ? 'var(--theme-warning)'
              : 'var(--theme-success)',
          }}
        />
        cron{' '}
        <b style={{ fontWeight: 400, ...(cronWarn ? warnStyle : textStyle) }}>
          {cronLabel}
        </b>
      </a>
      <a
        href="/settings"
        className="st"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          ...(configWarn ? warnStyle : mutedStyle),
        }}
        title={
          drift > 0
            ? `Local v${status?.configVersion} · latest v${status?.latestConfigVersion}`
            : 'config in sync'
        }
      >
        <span
          aria-hidden
          style={{
            ...dotBase,
            background: configWarn
              ? 'var(--theme-warning)'
              : 'var(--theme-success)',
          }}
        />
        config{' '}
        <b style={{ fontWeight: 400, ...(configWarn ? warnStyle : textStyle) }}>
          {configLabel}
        </b>
      </a>
      <a
        href="/operations"
        className="st"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          ...(logsWarn ? warnStyle : mutedStyle),
        }}
        title={
          logs === null
            ? 'log tail not loaded yet'
            : logErrorCount > 0
              ? `${logErrorCount} errors in the log tail`
              : 'no log errors in the tail'
        }
      >
        <span
          aria-hidden
          style={{
            ...dotBase,
            background: logsWarn
              ? 'var(--theme-warning)'
              : 'var(--theme-success)',
          }}
        />
        logs{' '}
        <b style={{ fontWeight: 400, ...(logsWarn ? warnStyle : textStyle) }}>
          {logsLabel}
        </b>
      </a>

      <span style={{ flexGrow: 1 }} />

      <span
        className="st"
        style={{
          ...mutedStyle,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          whiteSpace: 'nowrap',
        }}
        title={
          analyticsHasData
            ? `${analytics.windowDays}-day window`
            : 'analytics not loaded yet'
        }
      >
        sessions{' '}
        <b style={{ fontWeight: 400, ...textStyle }}>{sessionsLabel}</b>
      </span>
      <span
        className="st"
        style={{
          ...mutedStyle,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          whiteSpace: 'nowrap',
        }}
        title={
          analyticsHasData
            ? `${analytics.windowDays}-day window`
            : 'analytics not loaded yet'
        }
      >
        tokens <b style={{ fontWeight: 400, ...textStyle }}>{tokensLabel}</b>
      </span>
      <span
        className="st"
        style={{
          ...mutedStyle,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          whiteSpace: 'nowrap',
        }}
        title={
          analyticsHasData
            ? `${analytics.windowDays}-day window`
            : 'analytics not loaded yet'
        }
      >
        api calls <b style={{ fontWeight: 400, ...textStyle }}>{callsLabel}</b>
      </span>
      <span
        className="st"
        style={{
          ...mutedStyle,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          whiteSpace: 'nowrap',
        }}
        title={
          analyticsHasData ? 'analytics window' : 'analytics not loaded yet'
        }
      >
        {windowLabel}
      </span>
      <span
        className="st"
        style={{
          ...mutedStyle,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          whiteSpace: 'nowrap',
        }}
        title={
          modelInfo
            ? `${modelInfo.provider}/${modelInfo.model}`
            : 'no model info'
        }
      >
        model <b style={{ fontWeight: 400, ...textStyle }}>{modelLabel}</b>
      </span>
    </footer>
  )
}
