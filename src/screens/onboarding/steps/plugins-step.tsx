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
  /**
   * The `canWriteConfig` verdict. Enabling a plugin and restarting the
   * dashboard are real mutations of the user's agent, so a locked relaunch —
   * which the summary describes as read-only — renders neither.
   */
  canWrite: boolean
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
  canWrite,
}: PluginsStepProps) {
  return (
    <WizardPanel>
      <p>
        These are the core Interstellar Hermes Agent plugins. Each one is
        bundled with the agent and unlocks an extra screen once it is turned on.
      </p>
      {error ? <WizardNote tone="warn">{error}</WizardNote> : null}
      {loading ? <p>Loading plugin status…</p> : null}
      {!canWrite ? (
        <WizardNote tone="warn">
          Read-only for this run — plugin state is shown but cannot be changed.
          Choose &ldquo;Change setup&rdquo; on the summary first.
        </WizardNote>
      ) : null}
      <PluginPicker
        rows={rows}
        onToggle={onToggle}
        busyName={busyName}
        readOnly={!canWrite}
      />
      {canWrite ? (
        <>
          <div className="ob-restart-notice">
            <span>
              Plugin changes do not take effect until the Hermes dashboard
              restarts.
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
        </>
      ) : null}
    </WizardPanel>
  )
}
