'use client'

/**
 * plugins-step.tsx — the optional "core plugins" wizard step. Frames
 * `PluginPicker` with what these plugins are and the one caveat that
 * matters: nothing here takes effect until the dashboard restarts.
 */
import { PluginPicker } from '../components/plugin-picker'
import type { CorePluginRow } from '../lib/core-plugins'
import { WizardNote, WizardPanel } from '@/components/wizard'

export type PluginsStepProps = {
  rows: Array<CorePluginRow>
  loading: boolean
  error: string | null
  onToggle: (name: string, next: 'enable' | 'disable') => void
  busyName: string | null
  canRestart: boolean
  restarting: boolean
  onRestart: () => void
}

export function PluginsStep({
  rows,
  loading,
  error,
  onToggle,
  busyName,
  canRestart,
  restarting,
  onRestart,
}: PluginsStepProps) {
  return (
    <WizardPanel>
      <p>
        These are the core Interstellar Hermes Agent plugins — bundled extras
        that unlock extra screens once they are turned on.
      </p>
      {error ? <WizardNote tone="warn">{error}</WizardNote> : null}
      {loading ? <p>Loading plugin status…</p> : null}
      <PluginPicker rows={rows} onToggle={onToggle} busyName={busyName} />
      <div className="ob-restart-notice">
        <span>
          Plugin changes do not take effect until the Hermes dashboard restarts.
        </span>
        {canRestart ? (
          <button
            type="button"
            className="wz-btn"
            disabled={restarting}
            onClick={onRestart}
          >
            {restarting ? 'Restarting…' : 'Restart dashboard'}
          </button>
        ) : null}
      </div>
      {!canRestart ? <div className="ob-cli">hermes dashboard</div> : null}
    </WizardPanel>
  )
}
