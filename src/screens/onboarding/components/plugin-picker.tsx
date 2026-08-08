'use client'

/**
 * plugin-picker.tsx — one `.ob-plugin-row` per curated core plugin. Mirrors
 * `plugins-screen.tsx`'s enable/disable constraint exactly: only a
 * `bundled` plugin can be toggled from here, which `buildCorePluginRows`
 * already encodes as `action`. This component just renders whichever
 * action it was handed — it never re-derives the constraint itself.
 */
import { useState } from 'react'
import type { CorePluginRow, CorePluginState } from '../lib/core-plugins'

export type PluginPickerProps = {
  rows: Array<CorePluginRow>
  onToggle: (name: string, next: 'enable' | 'disable') => void
  busyName: string | null
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

  const handleCopy = () => {
    navigator.clipboard
      .writeText(command)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
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
}: {
  row: CorePluginRow
  busy: boolean
  onToggle: (name: string, next: 'enable' | 'disable') => void
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
      {row.action === 'enable' ? (
        <button
          type="button"
          className="wz-btn"
          disabled={busy}
          onClick={() => onToggle(row.name, 'enable')}
        >
          {busy ? 'Enabling…' : 'Enable'}
        </button>
      ) : null}
      {row.action === 'disable' ? (
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

export function PluginPicker({ rows, onToggle, busyName }: PluginPickerProps) {
  return (
    <div className="ob-plugins">
      {rows.map((row) => (
        <PluginRow
          key={row.name}
          row={row}
          busy={busyName === row.name}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}
