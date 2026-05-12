/**
 * section-telemetry.tsx — Telemetry settings section.
 *
 * No `telemetry.*` keys exist in DEFAULT_CONFIG.
 * Logging config lives under `logging.*`:
 *   logging.level        — DEBUG | INFO | WARNING
 *   logging.max_size_mb  — max log file size before rotation
 *   logging.backup_count — number of rotated backup files
 *
 * Dropped ghost keys (not in DEFAULT_CONFIG):
 *   telemetry.metrics, telemetry.traces, telemetry.otlp_endpoint,
 *   telemetry.sample_rate
 */

import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { Segmented, NumberSlider } from '../components/controls'
import { useSettingsStore } from '@/stores/settings-store'

const LOG_LEVELS = [
  { value: 'DEBUG', label: 'Debug' },
  { value: 'INFO', label: 'Info' },
  { value: 'WARNING', label: 'Warning' },
]

export default function SectionTelemetry() {
  const { draft, set } = useSettingsStore()

  // logging.* — real DEFAULT_CONFIG keys
  const logLevel = (draft['config.logging.level'] as string | undefined) ?? 'INFO'
  const maxSizeMb = (draft['config.logging.max_size_mb'] as number | undefined) ?? 5
  const backupCount = (draft['config.logging.backup_count'] as number | undefined) ?? 3

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Telemetry</h2>
          <div className="desc">File logging level, rotation, and backup policy.</div>
        </div>
        <div className="meta">Section · <b>logging</b></div>
      </div>

      <SettingCard title="Log level">
        <SettingRow
          label="Minimum log level"
          desc="Controls verbosity of ~/.hermes/logs/agent.log"
        >
          <Segmented
            options={LOG_LEVELS}
            value={logLevel}
            onChange={(v) => set('config.logging.level', v)}
          />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Log rotation">
        <SettingRow
          label="Max file size (MB)"
          desc={`Rotate agent.log after ${maxSizeMb} MB`}
        >
          <NumberSlider
            min={1}
            max={100}
            step={1}
            value={maxSizeMb}
            onChange={(v) => set('config.logging.max_size_mb', v)}
          />
        </SettingRow>
        <SettingRow
          label="Backup files to keep"
          desc={`Retain ${backupCount} rotated log files`}
        >
          <NumberSlider
            min={1}
            max={20}
            step={1}
            value={backupCount}
            onChange={(v) => set('config.logging.backup_count', v)}
          />
        </SettingRow>
      </SettingCard>
    </div>
  )
}
