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

function formatUptimeMs(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (diffSec < 60) return '< 1m'
  const days = Math.floor(diffSec / 86400)
  const hours = Math.floor((diffSec % 86400) / 3600)
  const minutes = Math.floor((diffSec % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
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
  const uptime = status ? formatUptimeMs(status.lastHeartbeatAt) : '—'
  const gatewayLabel = status
    ? gatewayOk
      ? `ok · ${uptime}`
      : status.gatewayState
    : '—'

  // Platforms
  const platforms = overview.platforms
  const connectedPlatforms = platforms.filter((p) =>
    isConnected(p.state),
  ).length
  const platformsLabel = `${connectedPlatforms}/${platforms.length}`

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

  // Logs
  const logs = overview.logs
  const logErrorCount = logs ? logs.errorCount : 0
  const logsLabel =
    logErrorCount > 0 ? `${logErrorCount} errors / 1h` : 'no errors / 1h'
  const logsWarn = logErrorCount > 0

  // Right side: period totals + model
  const analytics = overview.analytics
  const tokensLabel = analytics ? formatTokens(analytics.totalTokens) : '—'
  const sessionsLabel = analytics ? formatCompact(analytics.totalSessions) : '—'
  const callsLabel = analytics ? formatCompact(analytics.totalApiCalls) : '—'
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
            background: gatewayOk
              ? 'var(--theme-success)'
              : 'var(--theme-warning)',
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
          logErrorCount > 0
            ? `${logErrorCount} errors in the last hour`
            : 'no log errors in the last hour'
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
        title={`${period}-day window`}
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
        title={`${period}-day window`}
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
        title={`${period}-day window`}
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
      >
        {period}d
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
