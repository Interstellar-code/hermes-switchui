/**
 * section-shortcuts.tsx — Keyboard shortcuts section.
 *
 * Previously exposed six free-text "rebind" inputs (global search, new
 * session, toggle terminal, command palette, save changes, chat with wiki)
 * writing hermes.shortcut.* keys — no keyboard handler in the app ever read
 * any of them, so typing a new binding changed nothing. Deleted outright
 * (plan immutable-noodling-koala, Stream 1B).
 *
 * What's left is a read-only reference of the shortcuts that are actually
 * wired up (src/hooks/use-global-shortcuts.ts and
 * src/components/keyboard-shortcuts-modal.tsx, which the in-app "?" key
 * opens) — accurate instead of pretending to be editable.
 */

import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)
const MOD = isMac ? '⌘' : 'Ctrl'

const SHORTCUTS: Array<{ label: string; keys: string }> = [
  { label: 'Open search', keys: `${MOD}+K` },
  { label: 'Quick open file', keys: `${MOD}+P` },
  { label: 'Toggle sidebar', keys: `${MOD}+B` },
  { label: 'Toggle chat panel', keys: `${MOD}+J` },
  { label: 'Activity log', keys: `${MOD}+Shift+L` },
  { label: 'Toggle terminal', keys: 'Ctrl+`' },
  { label: 'Keyboard shortcuts', keys: '?' },
]

export default function SectionShortcuts() {
  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Keyboard Shortcuts</h2>
          <div className="desc">Global shortcuts wired up in this build. Not currently rebindable.</div>
        </div>
        <div className="meta">Section · <b>shortcuts</b></div>
      </div>

      <SettingCard title="Bindings" sub="read-only">
        {SHORTCUTS.map((s) => (
          <SettingRow key={s.label} label={s.label} rowEnd>
            <span
              style={{
                fontFamily: 'var(--m-font-mono)',
                fontSize: 12,
                padding: '2px 8px',
                border: '1px solid var(--m-text-faint)',
                borderRadius: 4,
              }}
            >
              {s.keys}
            </span>
          </SettingRow>
        ))}
      </SettingCard>
    </div>
  )
}
