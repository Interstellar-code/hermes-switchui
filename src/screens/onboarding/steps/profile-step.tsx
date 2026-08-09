'use client'

/**
 * profile-step.tsx — the optional "agent profile" wizard step. Frames
 * `ProfilePicker` with what a profile is and the one caveat that matters:
 * the switch is only a pointer file until the gateway restarts.
 *
 * It chooses which profile is active and nothing more. Creating, editing,
 * cloning and deleting belong to the Agents screen's own wizard, which this
 * step links out to rather than reimplementing.
 */
import { CurrentSetupStrip } from '../components/current-setup-strip'
import { ProfilePicker } from '../components/profile-picker'
import type { SetupFact } from '../lib/current-setup'
import type { ProfileChoice } from '../lib/profile-choices'
import { WizardNote, WizardPanel } from '@/components/wizard'

export type ProfileStepProps = {
  choices: Array<ProfileChoice>
  activeName: string | null
  loading: boolean
  error: string | null
  onActivate: (name: string) => void
  activating: string | null
  canWrite: boolean
  needsRestart: boolean
  facts: Array<SetupFact>
}

export function ProfileStep({
  choices,
  activeName,
  loading,
  error,
  onActivate,
  activating,
  canWrite,
  needsRestart,
  facts,
}: ProfileStepProps) {
  return (
    <WizardPanel>
      <CurrentSetupStrip facts={facts} />
      <p>
        A profile is an agent identity — its own model, system prompt, skills,
        memory and sessions. Exactly one is active at a time, and it is the one
        the Hermes gateway boots into.
      </p>
      {/* `warn`, not `error`: a list that failed to load means we cannot show
          the profiles, not that the setup is broken. */}
      {error ? <WizardNote tone="warn">{error}</WizardNote> : null}
      {loading ? <p>Loading agent profiles…</p> : null}
      <ProfilePicker
        choices={choices}
        activeName={activeName}
        onActivate={onActivate}
        activating={activating}
        canWrite={canWrite}
      />
      {needsRestart ? (
        <>
          <div className="ob-restart-notice">
            <span>
              The profile switch does not take effect until the Hermes gateway
              restarts — until then the gateway keeps running the profile it
              started with.
            </span>
          </div>
          <div className="ob-cli">hermes gateway restart</div>
        </>
      ) : null}
      <p className="ob-profile-meta">
        Need a profile of your own?{' '}
        <a href="/profiles">Open the Agents screen</a> to create, edit or clone
        one.
      </p>
    </WizardPanel>
  )
}
