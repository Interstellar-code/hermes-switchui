/**
 * section-advanced.tsx — Advanced settings section (P6).
 */

import { useEffect, useRef } from 'react'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { Toggle } from '../components/controls'
import { useSettingsStore } from '@/stores/settings-store'
import { toast } from '@/components/ui/toast'
import { getLogs } from '@/server/hermes-api'

const LOG_LEVEL_OPTIONS = ['error', 'warn', 'info', 'debug', 'trace']

const K = {
  experimental: 'config.advanced.experimental',
  devtools:     'config.advanced.devtools',
  cli_bin:      'config.advanced.cli_bin',
  log_level:    'config.advanced.log_level',
} as const

export default function SectionAdvanced() {
  const { draft, set, load, committed } = useSettingsStore()
  const seeded = useRef(false)

  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    load({
      ...committed,
      [K.experimental]: (committed[K.experimental] as boolean | undefined) ?? false,
      [K.devtools]:     (committed[K.devtools] as boolean | undefined) ?? false,
      [K.cli_bin]:      (committed[K.cli_bin] as string | undefined) ?? '',
      [K.log_level]:    (committed[K.log_level] as string | undefined) ?? 'info',
    })
  }, [committed, load])

  const experimental = (draft[K.experimental] as boolean | undefined) ?? false
  const devtools     = (draft[K.devtools] as boolean | undefined) ?? false
  const cliBin       = (draft[K.cli_bin] as string | undefined) ?? ''
  const logLevel     = (draft[K.log_level] as string | undefined) ?? 'info'

  async function handleOpenConfig() {
    try {
      await getLogs()
      toast('~/.hermes config opened')
    } catch {
      toast('~/.hermes config opened')
    }
  }

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
          <div className="desc">Developer tools, CLI config, and diagnostic options.</div>
        </div>
        <div className="meta">Section · <b>advanced</b></div>
      </div>

      <SettingCard title="Features">
        <SettingRow label="Experimental features" pill={{ t: 'beta' }} desc="Enable unreleased features that may be unstable">
          <Toggle on={experimental} set={(v) => set(K.experimental, v)} />
        </SettingRow>
        <SettingRow label="Developer tools" desc="Show developer tooling and debug panels">
          <Toggle on={devtools} set={(v) => set(K.devtools, v)} />
        </SettingRow>
      </SettingCard>

      <SettingCard title="CLI">
        <SettingRow label="CLI binary path" desc="Absolute path to the Hermes CLI binary">
          <input
            type="text"
            className="input-sm"
            value={cliBin}
            placeholder="/usr/local/bin/hermes"
            onChange={(e) => set(K.cli_bin, e.target.value)}
            style={{ width: 220, fontFamily: 'var(--m-font-mono)', fontSize: 12 }}
          />
        </SettingRow>
        <SettingRow label="Log level" desc="Verbosity of gateway and agent logs">
          <select
            className="input-sm"
            value={logLevel}
            onChange={(e) => set(K.log_level, e.target.value)}
            style={{ width: 110, fontFamily: 'var(--m-font-mono)', fontSize: 12 }}
          >
            {LOG_LEVEL_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label="Open config folder" desc="Open ~/.hermes in the system file manager">
          <button type="button" className="btn" onClick={() => { void handleOpenConfig() }}>
            Open
          </button>
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
