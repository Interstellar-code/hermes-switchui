'use client'

/**
 * plugin-picker.tsx — one `.ob-plugin-row` per curated core plugin. Mirrors
 * `plugins-screen.tsx`'s enable/disable constraint exactly: only a
 * `bundled` plugin can be toggled from here, which `buildCorePluginRows`
 * already encodes as `action`. This component just renders whichever
 * action it was handed — it never re-derives the constraint itself.
 */
import { useEffect, useRef, useState } from 'react'
import { CORE_PLUGIN_GROUPS } from '../lib/core-plugins'
import type { CorePluginRow, CorePluginState } from '../lib/core-plugins'
import { writeTextToClipboard } from '@/lib/clipboard'

export type PluginPickerProps = {
  rows: Array<CorePluginRow>
  onToggle: (name: string, next: 'enable' | 'disable') => void
  busyName: string | null
  /** Locked relaunch: show state, offer no control that mutates the agent. */
  readOnly?: boolean
}

const STATE_CLASS: Record<CorePluginState, string> = {
  enabled: 'is-enabled',
  inactive: 'is-inactive',
  // No dedicated CSS variant for 'disabled' — it reads the same as
  // 'inactive' (not currently running, no error implied).
  disabled: 'is-inactive',
  absent: 'is-absent',
  self: 'is-self',
}

const STATE_LABEL: Record<CorePluginState, string> = {
  enabled: 'Enabled',
  inactive: 'Inactive',
  disabled: 'Disabled',
  absent: 'Not installed',
  self: 'This app',
}

const CopyIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    width="14"
    height="14"
    aria-hidden="true"
  >
    <rect x="9" y="9" width="11" height="11" rx="1.5" />
    <path d="M5 15V5a1.5 1.5 0 0 1 1.5-1.5H15" />
  </svg>
)

function PluginCliBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  // The reset is a timer, so it outlives an unmount unless it is cleared —
  // copying and then closing the wizard within 1.5s otherwise schedules a
  // setState against a component that is gone.
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current)
    },
    [],
  )

  const handleCopy = () => {
    // `writeTextToClipboard`, not `navigator.clipboard` directly: the latter
    // is undefined on insecure origins (LAN/HTTP access is a supported
    // deployment here) and throws synchronously out of the click handler.
    writeTextToClipboard(command)
      .then(() => {
        setCopied(true)
        if (resetTimer.current !== null) clearTimeout(resetTimer.current)
        resetTimer.current = setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {
        /* clipboard blocked — the command is still visible to copy by hand */
      })
  }

  return (
    <div className="ob-plugin-cli">
      <code>{command}</code>
      <button type="button" className="wz-btn" onClick={handleCopy}>
        {copied ? 'Copied' : <>{CopyIcon} Copy</>}
      </button>
      {/* The button's own label changing is not reliably announced while it
          holds focus; this region is. */}
      <span className="wz-sr" role="status">
        {copied ? 'Command copied to the clipboard.' : ''}
      </span>
      <p>
        This plugin isn&apos;t bundled, so it has to be enabled from the CLI.
      </p>
    </div>
  )
}

function PluginRow({
  row,
  busy,
  onToggle,
  readOnly,
}: {
  row: CorePluginRow
  busy: boolean
  onToggle: (name: string, next: 'enable' | 'disable') => void
  readOnly: boolean
}) {
  return (
    <div className="ob-plugin-row">
      <span className="ob-plugin-name">{row.label}</span>
      <span className={`ob-plugin-state ${STATE_CLASS[row.state]}`}>
        {STATE_LABEL[row.state]}
      </span>
      <p className="ob-plugin-purpose">{row.purpose}</p>
      {row.unlocks ? (
        <p className="ob-plugin-unlocks">Unlocks {row.unlocks}.</p>
      ) : null}
      {/* Absent, not disabled: a locked relaunch promises this screen is a
          read, and a greyed-out Enable still reads as "almost allowed". */}
      {!readOnly && row.action === 'enable' ? (
        <button
          type="button"
          className="wz-btn"
          disabled={busy}
          onClick={() => onToggle(row.name, 'enable')}
        >
          {busy ? 'Enabling…' : 'Enable'}
        </button>
      ) : null}
      {!readOnly && row.action === 'disable' ? (
        <button
          type="button"
          className="wz-btn"
          disabled={busy}
          onClick={() => onToggle(row.name, 'disable')}
        >
          {busy ? 'Disabling…' : 'Disable'}
        </button>
      ) : null}
      {row.action === 'cli' && row.cliCommand ? (
        <PluginCliBlock command={row.cliCommand} />
      ) : null}
    </div>
  )
}

/**
 * Grouped so the authorship claim stays true: everything under "Interstellar
 * plugins" is ours, and the upstream ones that happen to gate a screen this
 * UI ships sit under their own heading rather than being presented as ours.
 * An empty group renders nothing.
 */
export function PluginPicker({
  rows,
  onToggle,
  busyName,
  readOnly = false,
}: PluginPickerProps) {
  return (
    <div className="ob-plugins">
      {CORE_PLUGIN_GROUPS.map((group) => {
        const groupRows = rows.filter((row) => row.group === group.id)
        if (groupRows.length === 0) return null
        return (
          <section
            key={group.id}
            className="ob-plugin-group"
            aria-label={group.label}
          >
            <h4 className="ob-plugin-group-label">{group.label}</h4>
            {groupRows.map((row) => (
              <PluginRow
                key={row.name}
                row={row}
                busy={busyName === row.name}
                onToggle={onToggle}
                readOnly={readOnly}
              />
            ))}
          </section>
        )
      })}
    </div>
  )
}
