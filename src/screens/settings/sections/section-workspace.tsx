/**
 * section-workspace.tsx — Workspace settings section (P2).
 */

import { useEffect, useRef } from 'react'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { Segmented } from '../components/controls'
import { useSettingsStore } from '@/stores/settings-store'

const LS_KEYS: Record<string, string> = {
  'hermes.workspaceName': '',
  'hermes.lang': 'en',
  'hermes.tz': Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  'hermes.dateFmt': 'ISO',
  'hermes.startupView': 'Dashboard',
}

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '中文' },
]

const TIMEZONES = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'Europe/London', label: 'London (GMT)' },
  { value: 'Europe/Paris', label: 'Paris (CET)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
]

const DATE_FORMATS = [
  { value: 'ISO', label: 'ISO' },
  { value: 'US', label: 'US' },
  { value: 'EU', label: 'EU' },
]

const STARTUP_VIEWS = [
  { value: 'Dashboard', label: 'Dashboard' },
  { value: 'Chat', label: 'Chat' },
  { value: 'Files', label: 'Files' },
  { value: 'Last session', label: 'Last session' },
]

export default function SectionWorkspace() {
  const { draft, set } = useSettingsStore()
  const seeded = useRef(false)

  useEffect(() => {
    if (seeded.current) return
    seeded.current = true

    // Seed localStorage-backed keys
    for (const [key, defaultVal] of Object.entries(LS_KEYS)) {
      if (draft[key] === undefined) {
        const stored = localStorage.getItem(key)
        useSettingsStore.getState().load({
          ...useSettingsStore.getState().committed,
          [key]: stored ?? defaultVal,
        })
      }
    }
  }, [draft])

  const workspaceName = (draft['hermes.workspaceName'] as string | undefined) ?? ''
  const workspaceId = (draft['hermes.workspaceId'] as string | undefined) ?? '—'
  const lang = (draft['hermes.lang'] as string | undefined) ?? 'en'
  const tz = (draft['hermes.tz'] as string | undefined) ?? 'UTC'
  const dateFmt = (draft['hermes.dateFmt'] as string | undefined) ?? 'ISO'
  const startupView = (draft['hermes.startupView'] as string | undefined) ?? 'Dashboard'

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Workspace</h2>
          <div className="desc">Identity and regional preferences for this workspace.</div>
        </div>
        <div className="meta">Section · <b>workspace</b></div>
      </div>

      <SettingCard title="Identity" sub="local-only">
        <SettingRow label="Workspace name" desc="Display name shown in the UI">
          <input
            type="text"
            className="text-input"
            value={workspaceName}
            placeholder="My Workspace"
            onChange={(e) => set('hermes.workspaceName', e.target.value)}
          />
        </SettingRow>
        <SettingRow label="Workspace ID" pill={{ t: 'read-only' }}>
          <input
            type="text"
            className="text-input"
            value={workspaceId}
            readOnly
            disabled
          />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Regional">
        <SettingRow label="Language">
          <select
            className="select-input"
            value={lang}
            onChange={(e) => set('hermes.lang', e.target.value)}
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label="Timezone">
          <select
            className="select-input"
            value={tz}
            onChange={(e) => set('hermes.tz', e.target.value)}
          >
            {TIMEZONES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label="Date format">
          <Segmented
            options={DATE_FORMATS}
            value={dateFmt}
            onChange={(v) => set('hermes.dateFmt', v)}
          />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Behaviour">
        <SettingRow label="Startup view" desc="Screen shown when the app launches">
          <select
            className="select-input"
            value={startupView}
            onChange={(e) => set('hermes.startupView', e.target.value)}
          >
            {STARTUP_VIEWS.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </SettingRow>
      </SettingCard>
    </div>
  )
}
