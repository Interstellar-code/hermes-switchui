/**
 * section-shortcuts.tsx — Keyboard shortcuts section (P6).
 */

import { useEffect, useRef } from 'react'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { useSettingsStore } from '@/stores/settings-store'

type Binding = {
  id: string
  label: string
  defaultValue: string
}

const BINDINGS: Array<Binding> = [
  { id: 'shortcut_search',   label: 'Global search',    defaultValue: 'cmd+k' },
  { id: 'shortcut_newsess',  label: 'New session',      defaultValue: 'cmd+n' },
  { id: 'shortcut_term',     label: 'Toggle terminal',  defaultValue: 'ctrl+`' },
  { id: 'shortcut_palette',  label: 'Command palette',  defaultValue: 'cmd+shift+p' },
  { id: 'shortcut_save',     label: 'Save changes',     defaultValue: 'cmd+s' },
  { id: 'shortcut_chat',     label: 'Chat with wiki',   defaultValue: 'cmd+/' },
]

function lsKey(id: string) {
  return `hermes.shortcut.${id}`
}

export default function SectionShortcuts() {
  const { draft, set, load, committed } = useSettingsStore()
  const seeded = useRef(false)

  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    const patch: Record<string, unknown> = { ...committed }
    for (const b of BINDINGS) {
      const stored = localStorage.getItem(lsKey(b.id))
      patch[lsKey(b.id)] = stored ?? b.defaultValue
    }
    load(patch)
  }, [committed, load])

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Keyboard Shortcuts</h2>
          <div className="desc">Rebind global keyboard shortcuts.</div>
        </div>
        <div className="meta">Section · <b>shortcuts</b></div>
      </div>

      <SettingCard title="Bindings" sub="local-only">
        {BINDINGS.map((b) => {
          const key = lsKey(b.id)
          const value = (draft[key] as string | undefined) ?? b.defaultValue
          return (
            <SettingRow
              key={b.id}
              label={b.label}
              desc="Click to rebind. Modifier + key."
            >
              <input
                type="text"
                className="input-sm"
                value={value}
                onChange={(e) => {
                  set(key, e.target.value)
                  try { localStorage.setItem(key, e.target.value) } catch { /* ignore */ }
                }}
                style={{ width: 140, fontFamily: 'var(--m-font-mono)', fontSize: 12 }}
              />
            </SettingRow>
          )
        })}
      </SettingCard>
    </div>
  )
}
