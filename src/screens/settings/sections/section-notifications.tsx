/**
 * section-notifications.tsx — Notifications settings section (P2).
 */

import { useEffect, useRef } from 'react'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { Toggle } from '../components/controls'
import { useSettingsStore } from '@/stores/settings-store'

const LS_KEYS: Record<string, string> = {
  'hermes.notif.desktop': 'false',
  'hermes.notif.sound': 'false',
  'hermes.notif.email': 'false',
  'hermes.notif.slack': 'false',
  'hermes.notif.taskDone': 'false',
  'hermes.notif.error': 'false',
}

function boolDraft(v: unknown): boolean {
  return v === 'true' || v === true
}

export default function SectionNotifications() {
  const { draft, set } = useSettingsStore()
  const seeded = useRef(false)

  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    const patch: Record<string, unknown> = {}
    for (const [key, defaultVal] of Object.entries(LS_KEYS)) {
      if (draft[key] === undefined) {
        patch[key] = localStorage.getItem(key) ?? defaultVal
      }
    }
    if (Object.keys(patch).length > 0) {
      useSettingsStore.getState().load({
        ...useSettingsStore.getState().committed,
        ...patch,
      })
    }
  }, [draft])

  const desktop = boolDraft(draft['hermes.notif.desktop'])
  const sound = boolDraft(draft['hermes.notif.sound'])
  const email = boolDraft(draft['hermes.notif.email'])
  const slack = boolDraft(draft['hermes.notif.slack'])
  const taskDone = boolDraft(draft['hermes.notif.taskDone'])
  const error = boolDraft(draft['hermes.notif.error'])

  function toggle(key: string, v: boolean) {
    set(key, v ? 'true' : 'false')
  }

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Notifications</h2>
          <div className="desc">Control how and where you receive alerts.</div>
        </div>
        <div className="meta">Section · <b>notifications</b></div>
      </div>

      <SettingCard title="Channels">
        <SettingRow label="Desktop notifications" rowEnd>
          <Toggle on={desktop} set={(v) => toggle('hermes.notif.desktop', v)} />
        </SettingRow>
        <SettingRow label="Sound" rowEnd>
          <Toggle on={sound} set={(v) => toggle('hermes.notif.sound', v)} />
        </SettingRow>
        <SettingRow label="Email digest" rowEnd>
          <Toggle on={email} set={(v) => toggle('hermes.notif.email', v)} />
        </SettingRow>
        <SettingRow
          label="Slack"
          pill={{ t: slack ? 'connected' : 'local-only' }}
          rowEnd
        >
          <Toggle on={slack} set={(v) => toggle('hermes.notif.slack', v)} />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Events">
        <SettingRow label="Notify on task done" rowEnd>
          <Toggle on={taskDone} set={(v) => toggle('hermes.notif.taskDone', v)} />
        </SettingRow>
        <SettingRow label="Notify on error" rowEnd>
          <Toggle on={error} set={(v) => toggle('hermes.notif.error', v)} />
        </SettingRow>
      </SettingCard>
    </div>
  )
}
