/**
 * section-danger.tsx — Danger zone section (P6).
 */

import { useState } from 'react'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { ConfirmDialog } from '../components/confirm-dialog'
import { toast } from '@/components/ui/toast'
import { gatewayRestart } from '@/lib/hermes-client'

export default function SectionDanger() {
  const [resetOpen, setResetOpen] = useState(false)
  const [restartOpen, setRestartOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  function handleClearCaches() {
    toast('Cache management not available on this gateway', { type: 'warning' })
  }

  async function handleResetSettings() {
    // Clear all hermes.* localStorage keys
    const keys: Array<string> = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('hermes.')) keys.push(k)
    }
    keys.forEach((k) => localStorage.removeItem(k))
    try {
      await gatewayRestart()
    } catch {
      // ignore
    }
    toast('Settings reset to defaults')
    setResetOpen(false)
  }

  async function handleRestartGateway() {
    try {
      await gatewayRestart()
      toast('Gateway restart requested')
    } catch {
      toast('Gateway restart failed')
    }
    setRestartOpen(false)
  }

  function handleDeleteWorkspace() {
    toast('Workspace deletion endpoint is not available on this gateway', { type: 'warning' })
    setDeleteOpen(false)
    setDeleteConfirmText('')
  }

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Danger Zone</h2>
          <div className="desc">Irreversible and destructive operations.</div>
        </div>
        <div className="meta">Section · <b>danger</b></div>
      </div>

      <SettingCard title="Destructive actions" danger>
        <SettingRow label="Clear all caches" desc="Flush all cached data and query results">
          <button type="button" className="btn" onClick={handleClearCaches}>
            Clear caches
          </button>
        </SettingRow>

        <SettingRow label="Reset settings to defaults" desc="Wipe all hermes.* localStorage keys and restart the gateway">
          <button type="button" className="btn btn-danger" onClick={() => setResetOpen(true)}>
            Reset settings
          </button>
        </SettingRow>

        <SettingRow label="Restart gateway" desc="Send a restart signal to the Hermes gateway process">
          <button type="button" className="btn btn-danger" onClick={() => setRestartOpen(true)}>
            Restart
          </button>
        </SettingRow>

        <SettingRow
          label="Delete workspace"
          pill={{ t: 'irreversible req' }}
          desc="Permanently delete all workspace data"
        >
          <button type="button" className="btn btn-danger" onClick={() => { setDeleteOpen(true); setDeleteConfirmText('') }}>
            Delete workspace
          </button>
        </SettingRow>
      </SettingCard>

      {/* Reset settings dialog */}
      <ConfirmDialog
        open={resetOpen}
        title="Reset settings to defaults?"
        message="All hermes.* localStorage settings will be cleared and the gateway will be restarted. This cannot be undone."
        confirmLabel="Reset"
        destructive
        onConfirm={() => { void handleResetSettings() }}
        onCancel={() => setResetOpen(false)}
      />

      {/* Restart gateway dialog */}
      <ConfirmDialog
        open={restartOpen}
        title="Restart gateway?"
        message="The Hermes gateway process will be restarted. Active sessions may be interrupted."
        confirmLabel="Restart"
        destructive
        onConfirm={() => { void handleRestartGateway() }}
        onCancel={() => setRestartOpen(false)}
      />

      {/* Delete workspace dialog with typed confirmation */}
      <ConfirmDialog
        open={deleteOpen}
        title="Delete workspace?"
        message={
          <>
            This action is <strong>irreversible</strong>. All workspace data will be
            permanently destroyed. Type <code>DELETE</code> to confirm.
          </>
        }
        confirmLabel="Delete workspace"
        destructive
        confirmDisabled={deleteConfirmText !== 'DELETE'}
        onConfirm={handleDeleteWorkspace}
        onCancel={() => { setDeleteOpen(false); setDeleteConfirmText('') }}
      >
        <input
          type="text"
          value={deleteConfirmText}
          onChange={(e) => setDeleteConfirmText(e.target.value)}
          placeholder="Type DELETE"
          aria-label="Type DELETE to confirm"
          className="w-full rounded-md border border-[var(--m-border,var(--theme-border))] bg-[var(--m-bg,var(--theme-bg))] px-3 py-2 font-mono text-sm text-[var(--m-text,var(--theme-text))] outline-none focus-visible:ring-2 focus-visible:ring-[var(--m-green-500,var(--theme-accent))]"
          autoFocus
        />
      </ConfirmDialog>
    </div>
  )
}
