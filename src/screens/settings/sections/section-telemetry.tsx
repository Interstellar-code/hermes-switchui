/**
 * section-telemetry.tsx — Telemetry settings section (P5).
 */

import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { Toggle } from '../components/controls'
import { useSettingsStore } from '@/stores/settings-store'

export default function SectionTelemetry() {
  const { draft, set } = useSettingsStore()

  const metrics = (draft['config.telemetry.metrics'] as boolean | undefined) ?? false
  const traces = (draft['config.telemetry.traces'] as boolean | undefined) ?? false
  const otlpEndpoint = (draft['config.telemetry.otlp_endpoint'] as string | undefined) ?? ''
  const sampleRate = (draft['config.telemetry.sample_rate'] as number | undefined) ?? 0.1

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Telemetry</h2>
          <div className="desc">OpenTelemetry metrics, traces, and sampling configuration.</div>
        </div>
        <div className="meta">Section · <b>telemetry</b></div>
      </div>

      <SettingCard title="Collection">
        <SettingRow label="Metrics enabled" desc="Collect and export metrics via OTLP">
          <Toggle on={metrics} set={(v) => set('config.telemetry.metrics', v)} />
        </SettingRow>
        <SettingRow label="Traces enabled" desc="Collect and export distributed traces via OTLP">
          <Toggle on={traces} set={(v) => set('config.telemetry.traces', v)} />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Export">
        <SettingRow label="OTLP endpoint" desc="Collector endpoint URL (e.g. http://localhost:4318)">
          <input
            type="text"
            className="text-input"
            value={otlpEndpoint}
            placeholder="http://localhost:4318"
            onChange={(e) => set('config.telemetry.otlp_endpoint', e.target.value)}
          />
        </SettingRow>
        <SettingRow label="Sample rate" desc={`${sampleRate.toFixed(2)} (0 = off, 1 = all)`}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={sampleRate}
            onChange={(e) => set('config.telemetry.sample_rate', parseFloat(e.target.value))}
          />
        </SettingRow>
      </SettingCard>
    </div>
  )
}
