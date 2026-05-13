/**
 * section-account.tsx — Account settings section (P2).
 * Local profile only — no hermes-agent backend for account/2FA.
 */

import { useEffect, useRef } from 'react'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { useSettingsStore } from '@/stores/settings-store'

const LS_KEYS: Record<string, string> = {
  'hermes.displayName': '',
  'hermes.org': '',
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

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Account</h2>
          <div className="desc">Personal identity stored locally in this browser.</div>
        </div>
        <div className="meta">Section · <b>account</b></div>
      </div>

      <SettingCard title="Local profile" sub="local-only">
        <SettingRow label="Display name" desc="Name shown in chat and activity logs">
          <input
            type="text"
            className="text-input"
            value={displayName}
            placeholder="Your name"
            onChange={(e) => set('hermes.displayName', e.target.value)}
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
    </div>
  )
}
