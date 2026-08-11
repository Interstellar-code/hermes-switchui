/**
 * section-advanced.tsx — Advanced settings section (P6).
 */

import { useEffect } from 'react'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { useSettingsStore } from '@/stores/settings-store'
import { toast } from '@/components/ui/toast'
import { getLogs } from '@/lib/hermes-client'

// Maps to DEFAULT_CONFIG logging.level (DEBUG | INFO | WARNING)
const LOG_LEVEL_OPTIONS = ['DEBUG', 'INFO', 'WARNING']

const K = {
  log_level: 'config.logging.level',
} as const

export default function SectionAdvanced() {
  const draft = useSettingsStore((s) => s.draft)
  const set = useSettingsStore((s) => s.set)
  const registerDefaults = useSettingsStore((s) => s.registerDefaults)

  // This used to call `load({ ...committed, [K.log_level]: … })` on mount,
  // which reset the whole store — flipping `loaded` before the server fetch
  // resolved and discarding every other section's edits. `registerDefaults`
  // is additive and idempotent: it touches neither `committed` nor `dirty`.
  useEffect(() => {
    registerDefaults({ [K.log_level]: 'INFO' })
  }, [registerDefaults])

  const logLevel = (draft[K.log_level] as string | undefined) ?? 'INFO'

  async function handleViewLogs() {
    try {
      const result = await getLogs()
      const count = Array.isArray(result) ? result.length : (result ? 1 : 0)
      toast(`${count} log entr${count === 1 ? 'y' : 'ies'} retrieved`)
    } catch {
      toast('Failed to fetch logs')
    }
  }

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Advanced</h2>
          <div className="desc">Logging and diagnostic options.</div>
        </div>
        <div className="meta">Section · <b>advanced</b></div>
      </div>

      <SettingCard title="Logging">
        <SettingRow label="Log level" desc="Minimum verbosity written to ~/.hermes/logs/agent.log">
          <select
            className="input-sm"
            value={logLevel}
            onChange={(e) => set(K.log_level, e.target.value)}
            style={{ width: 110, fontFamily: 'var(--m-font-mono, ui-monospace, monospace)', fontSize: 12 }}
          >
            {LOG_LEVEL_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </SettingRow>
      </SettingCard>

      <SettingCard title="Diagnostics">
        <SettingRow label="View recent logs" desc="Fetch and count recent gateway log entries">
          <button type="button" className="btn" onClick={() => { void handleViewLogs() }}>
            View logs
          </button>
        </SettingRow>
      </SettingCard>
    </div>
  )
}
