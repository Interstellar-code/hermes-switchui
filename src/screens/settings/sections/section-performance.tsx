/**
 * section-performance.tsx — Performance settings section.
 *
 * Previously also held three localStorage-backed toggles (hardware
 * acceleration, prefetch on hover, background-tab behaviour) writing
 * hermes.perf.* keys nothing else read. "Hardware acceleration" has no
 * meaning in a browser page, and prefetch/background behaviour were never
 * wired to any handler. Deleted outright (plan immutable-noodling-koala,
 * Stream 1B).
 *
 * What's left is real: a live snapshot of the hermes-agent gateway process,
 * backed by the ['gateway-status'] query. Real GatewayStatus fields:
 * gateway_running, pid. cpu/rss are in GatewayStatus but not currently
 * exposed by the gateway — rendered only when present.
 */

import { useQuery } from '@tanstack/react-query'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { gatewayStatus } from '@/lib/hermes-client'

export default function SectionPerformance() {
  const { data: status } = useQuery({
    queryKey: ['gateway-status'],
    queryFn: gatewayStatus,
    staleTime: 15_000,
    refetchInterval: 15_000,
  })

  const daemonRunning = status?.gateway_running
  const daemonPid = status?.pid
  const cpu = status?.cpu
  const rss = status?.rss

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Performance</h2>
          <div className="desc">Live status of the hermes-agent gateway process.</div>
        </div>
        <div className="meta">Section · <b>performance</b></div>
      </div>

      <SettingCard title="Process snapshot">
        <SettingRow label="Gateway process" pill={{ t: 'live' }}>
          <span style={{ display: 'flex', gap: 12, fontSize: 12, fontFamily: 'var(--m-font-mono, ui-monospace, monospace)' }}>
            {daemonRunning === undefined ? (
              <span style={{ color: 'var(--m-text-faint, var(--theme-muted))' }}>—</span>
            ) : !daemonRunning ? (
              <span style={{ color: 'var(--m-danger, var(--theme-danger))' }}>stopped</span>
            ) : (
              <>
                <span style={{ color: 'var(--m-green-500, var(--theme-accent))' }}>running</span>
                {daemonPid !== undefined && (
                  <>
                    <span style={{ color: 'var(--m-text-faint, var(--theme-muted))' }}>·</span>
                    <span>PID <b>{daemonPid}</b></span>
                  </>
                )}
                {cpu !== undefined && (
                  <>
                    <span style={{ color: 'var(--m-text-faint, var(--theme-muted))' }}>·</span>
                    <span>CPU <b>{typeof cpu === 'number' ? cpu.toFixed(1) : cpu}%</b></span>
                  </>
                )}
                {rss !== undefined && (
                  <>
                    <span style={{ color: 'var(--m-text-faint, var(--theme-muted))' }}>·</span>
                    <span>RSS <b>{typeof rss === 'number' ? (rss / 1024 / 1024).toFixed(1) : rss} MB</b></span>
                  </>
                )}
              </>
            )}
          </span>
        </SettingRow>
      </SettingCard>
    </div>
  )
}
