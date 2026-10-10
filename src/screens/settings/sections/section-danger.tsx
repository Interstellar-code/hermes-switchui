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
      toast('Local UI settings reset')
    } catch {
      toast('Local UI settings reset — gateway restart failed', {
        type: 'warning',
      })
    }
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

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Danger Zone</h2>
          <div className="desc">Irreversible and destructive operations.</div>
        </div>
        <div className="meta">
          Section · <b>danger</b>
        </div>
      </div>

      <SettingCard title="Destructive actions" danger>
        <SettingRow
          label="Reset local UI settings"
          desc="Clears SwitchUI's hermes.* localStorage keys in this browser and restarts the gateway — it does not touch the agent's config.yaml"
        >
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => setResetOpen(true)}
          >
            Reset local UI settings
          </button>
        </SettingRow>

        <SettingRow
          label="Restart gateway"
          desc="Send a restart signal to the Hermes gateway process"
        >
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => setRestartOpen(true)}
          >
            Restart
          </button>
        </SettingRow>
      </SettingCard>

      {/* Reset local UI settings dialog */}
      <ConfirmDialog
        open={resetOpen}
        title="Reset local UI settings?"
        message="SwitchUI will clear every hermes.* key in this browser's localStorage — its own UI settings only; the agent's config.yaml on disk is untouched — and then request a gateway restart. This cannot be undone."
        confirmLabel="Reset local UI settings"
        destructive
        onConfirm={() => {
          void handleResetSettings()
        }}
        onCancel={() => setResetOpen(false)}
      />

      {/* Restart gateway dialog */}
      <ConfirmDialog
        open={restartOpen}
        title="Restart gateway?"
        message="The Hermes gateway process will be restarted. Active sessions may be interrupted."
        confirmLabel="Restart"
        destructive
        onConfirm={() => {
          void handleRestartGateway()
        }}
        onCancel={() => setRestartOpen(false)}
      />
    </div>
  )
}
