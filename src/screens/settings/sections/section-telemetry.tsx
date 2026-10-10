/**
 * section-telemetry.tsx — Telemetry settings section.
 *
 * No `telemetry.*` keys exist in DEFAULT_CONFIG. Logging config lives under
 * `logging.*`; `logging.level` is edited in Advanced (one control per key —
 * this section only covers rotation):
 *   logging.max_size_mb  — max log file size before rotation
 *   logging.backup_count — number of rotated backup files
 *
 * Dropped ghost keys (not in DEFAULT_CONFIG):
 *   telemetry.metrics, telemetry.traces, telemetry.otlp_endpoint,
 *   telemetry.sample_rate
 */

import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { NumberSlider } from '../components/controls'
import { getKeyMeta } from '../lib/key-meta'
import { useSettingsStore } from '@/stores/settings-store'

export default function SectionTelemetry() {
  const draft = useSettingsStore((s) => s.draft)
  const set = useSettingsStore((s) => s.set)

  // logging.* — real DEFAULT_CONFIG keys
  const maxSizeMb =
    (draft['config.logging.max_size_mb'] as number | undefined) ?? 5
  const backupCount =
    (draft['config.logging.backup_count'] as number | undefined) ?? 3

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Telemetry</h2>
          <div className="desc">File logging rotation and backup policy.</div>
        </div>
        <div className="meta">
          Section · <b>logging</b>
        </div>
      </div>

      <SettingCard title="Log level">
        <div
          style={{
            padding: '0 18px 14px',
            fontSize: '12px',
            color: 'var(--m-text-faint, var(--theme-muted))',
          }}
        >
          Log level is under Advanced.
        </div>
      </SettingCard>

      <SettingCard title="Log rotation">
        <SettingRow
          label="Max file size (MB)"
          desc={`Rotate agent.log after ${maxSizeMb} MB`}
          meta={getKeyMeta('config.logging.max_size_mb')}
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
          meta={getKeyMeta('config.logging.backup_count')}
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
