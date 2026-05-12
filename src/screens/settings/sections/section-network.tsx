/**
 * section-network.tsx — Network settings section.
 *
 * Real DEFAULT_CONFIG keys:
 *   network.force_ipv4   — skip IPv6 to avoid TCP-timeout hangs on broken stacks
 *
 * Dropped ghost keys (not in DEFAULT_CONFIG):
 *   network.http_proxy, network.allow_insecure_tls,
 *   network.request_timeout_s, network.offline
 *
 * Gateway status uses real GatewayStatus fields: gateway_running, pid.
 */

import { useQuery } from '@tanstack/react-query'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { Toggle } from '../components/controls'
import { useSettingsStore } from '@/stores/settings-store'
import { gatewayStatus } from '@/lib/hermes-client'

export default function SectionNetwork() {
  const { draft, set } = useSettingsStore()

  const { data: status } = useQuery({
    queryKey: ['gateway-status'],
    queryFn: gatewayStatus,
    staleTime: 15_000,
    refetchInterval: 15_000,
  })

  // network.* — real DEFAULT_CONFIG keys
  const forceIpv4 = (draft['config.network.force_ipv4'] as boolean | undefined) ?? false

  // Real GatewayStatus fields
  const daemonRunning = status?.gateway_running
  const daemonPid = status?.pid

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Network</h2>
          <div className="desc">IPv4 preference and daemon connectivity.</div>
        </div>
        <div className="meta">Section · <b>network</b></div>
      </div>

      <SettingCard title="Connectivity">
        <SettingRow
          label="Force IPv4"
          desc="Skip IPv6 (AAAA) lookups — fixes TCP-timeout hangs on servers with broken IPv6"
        >
          <Toggle on={forceIpv4} set={(v) => set('config.network.force_ipv4', v)} />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Daemon">
        <SettingRow label="Local gateway" pill={{ t: 'live' }} desc="Hermes agent process status">
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, fontFamily: 'var(--m-font-mono)' }}>
            {daemonRunning === undefined ? (
              <span style={{ color: 'var(--m-text-faint)' }}>—</span>
            ) : daemonRunning ? (
              <>
                <span style={{ color: 'var(--m-accent)' }}>running</span>
                {daemonPid !== undefined && (
                  <>
                    <span style={{ color: 'var(--m-text-faint)' }}>·</span>
                    <span style={{ color: 'var(--m-text-faint)' }}>PID {daemonPid}</span>
                  </>
                )}
              </>
            ) : (
              <span style={{ color: '#e05' }}>stopped</span>
            )}
          </span>
        </SettingRow>
      </SettingCard>
    </div>
  )
}
