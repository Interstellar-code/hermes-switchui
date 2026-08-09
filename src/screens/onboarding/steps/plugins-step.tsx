'use client'

/**
 * plugins-step.tsx — the optional "core plugins" wizard step. Frames
 * `PluginPicker` with what these plugins are and the one caveat that
 * matters: nothing here takes effect until the dashboard restarts.
 */
import { CurrentSetupStrip } from '../components/current-setup-strip'
import { PluginPicker } from '../components/plugin-picker'
import type { CorePluginRow } from '../lib/core-plugins'
import type { SetupFact } from '../lib/current-setup'
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
  facts: Array<SetupFact>
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
  facts,
}: PluginsStepProps) {
  return (
    <WizardPanel>
      <CurrentSetupStrip facts={facts} />
      <p>
        Plugins extend the agent. The first group is built by Interstellar; the
        second is upstream, but each one gates a screen this workspace ships.
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
