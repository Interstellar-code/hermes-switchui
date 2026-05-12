/**
 * section-network.tsx — Network settings section (P5).
 */

import { useQuery } from '@tanstack/react-query'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { Toggle } from '../components/controls'
import { useSettingsStore } from '@/stores/settings-store'
import { gatewayStatus } from '@/server/hermes-api'

export default function SectionNetwork() {
  const { draft, set } = useSettingsStore()

  const { data: status } = useQuery({
    queryKey: ['gateway-status'],
    queryFn: gatewayStatus,
    staleTime: 15_000,
    refetchInterval: 15_000,
  })

  const httpProxy = (draft['config.network.http_proxy'] as string | undefined) ?? ''
  const allowInsecure = (draft['config.network.allow_insecure_tls'] as boolean | undefined) ?? false
  const requestTimeout = (draft['config.network.request_timeout_s'] as number | undefined) ?? 60
  const offline = (draft['config.network.offline'] as boolean | undefined) ?? false

  const daemonRunning = status?.gateway_running
  const daemonPid = status?.pid

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Network</h2>
          <div className="desc">Proxy, TLS, timeouts, and daemon connectivity.</div>
        </div>
        <div className="meta">Section · <b>network</b></div>
      </div>

      <SettingCard title="Proxy">
        <SettingRow label="HTTP proxy" desc="Proxy URL for outbound requests (e.g. http://proxy:8080)">
          <input
            type="text"
            className="text-input"
            value={httpProxy}
            placeholder="http://proxy.example.com:8080"
            onChange={(e) => set('config.network.http_proxy', e.target.value)}
          />
        </SettingRow>
      </SettingCard>

      <SettingCard title="TLS & security">
        <SettingRow label="Allow insecure TLS" pill={{ t: 'danger' }} desc="Accept self-signed and expired certificates">
          <Toggle on={allowInsecure} set={(v) => set('config.network.allow_insecure_tls', v)} />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Timeouts & mode">
        <SettingRow label="Request timeout (s)" desc={`${requestTimeout}s`}>
          <input
            type="range"
            min={5}
            max={300}
            step={5}
            value={requestTimeout}
            onChange={(e) => set('config.network.request_timeout_s', parseInt(e.target.value, 10))}
          />
        </SettingRow>
        <SettingRow label="Offline mode" desc="Disable all outbound network requests">
          <Toggle on={offline} set={(v) => set('config.network.offline', v)} />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Daemon">
        <SettingRow label="Local daemon" pill={{ t: 'live' }} desc="Hermes agent gateway process status">
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, fontFamily: 'var(--m-font-mono)' }}>
            <span className={`pill ${daemonRunning ? 'pill-ok' : 'pill-warn'}`}>
              {daemonRunning === undefined ? 'checking…' : daemonRunning ? 'online' : 'offline'}
            </span>
            {daemonPid !== undefined && (
              <span style={{ color: 'var(--m-text-faint)' }}>pid {daemonPid}</span>
            )}
          </span>
        </SettingRow>
      </SettingCard>
    </div>
  )
}
