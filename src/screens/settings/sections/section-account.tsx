/**
 * section-account.tsx — Account settings section (P2).
 */

import { useEffect, useRef } from 'react'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { Toggle } from '../components/controls'
import { useSettingsStore } from '@/stores/settings-store'

const LS_KEYS: Record<string, string> = {
  'hermes.displayName': '',
  'hermes.org': '',
  'hermes.twoFactor': 'false',
}

export default function SectionAccount() {
  const { draft, set } = useSettingsStore()
  const seeded = useRef(false)

  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
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

  const displayName = (draft['hermes.displayName'] as string | undefined) ?? ''
  const org = (draft['hermes.org'] as string | undefined) ?? ''
  const twoFactor = draft['hermes.twoFactor'] === 'true' || draft['hermes.twoFactor'] === true

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Account</h2>
          <div className="desc">Personal identity and security settings.</div>
        </div>
        <div className="meta">Section · <b>account</b></div>
      </div>

      <SettingCard title="Profile">
        <SettingRow label="Display name" desc="Name shown in chat and activity logs">
          <input
            type="text"
            className="text-input"
            value={displayName}
            placeholder="Your name"
            onChange={(e) => set('hermes.displayName', e.target.value)}
          />
        </SettingRow>
        <SettingRow label="Email" pill={{ t: 'verified' }}>
          <input
            type="email"
            className="text-input"
            value=""
            readOnly
            disabled
            placeholder="email@example.com"
          />
        </SettingRow>
        <SettingRow label="Organisation">
          <input
            type="text"
            className="text-input"
            value={org}
            placeholder="Org name"
            onChange={(e) => set('hermes.org', e.target.value)}
          />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Security">
        <SettingRow label="Two-factor authentication" desc="UI stub — no 2FA backend" rowEnd>
          <Toggle
            on={twoFactor}
            set={(v) => set('hermes.twoFactor', v ? 'true' : 'false')}
          />
        </SettingRow>
      </SettingCard>
    </div>
  )
}
