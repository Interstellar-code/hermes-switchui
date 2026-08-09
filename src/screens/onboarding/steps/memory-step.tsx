'use client'

/**
 * memory-step.tsx — the optional "memory" wizard step. Frames `MemoryPicker`
 * with what memory is, which provider this workspace recommends and why, and
 * the two caveats that matter: nothing takes effect until the gateway
 * restarts, and memories do not travel between providers.
 *
 * The naming note is load-bearing, not decoration. "Matrix Memory" is a
 * product name that collides with the Matrix chat protocol, and a user who
 * knows the protocol will assume a homeserver, an account and a network
 * dependency — none of which exist. Both the card description and the prose
 * below say what it actually is (one local SQLite file on the Mnemosyne
 * engine) and deny the network dependency outright.
 */
import { CurrentSetupStrip } from '../components/current-setup-strip'
import { MemoryPicker } from '../components/memory-picker'
import type { MemoryChoice } from '../lib/memory-choices'
import type { MemoryStoreStats } from '../hooks/use-onboarding-memory'
import type { SetupFact } from '../lib/current-setup'
import { WizardNote, WizardPanel } from '@/components/wizard'

export type MemoryStepProps = {
  choices: Array<MemoryChoice>
  activeProvider: string | null
  loading: boolean
  error: string | null
  onSelect: (id: string) => void
  selecting: string | null
  canWrite: boolean
  touched: boolean
  needsRestart: boolean
  stats: MemoryStoreStats | null
  facts: Array<SetupFact>
}

export function MemoryStep({
  choices,
  activeProvider,
  loading,
  error,
  onSelect,
  selecting,
  canWrite,
  touched,
  needsRestart,
  stats,
  facts,
}: MemoryStepProps) {
  return (
    <WizardPanel>
      <CurrentSetupStrip facts={facts} />
      <p>
        Memory is what lets the agent recall facts and decisions across
        sessions. Hermes always keeps the built-in <code>MEMORY.md</code> and{' '}
        <code>USER.md</code> files; a memory provider adds searchable long-term
        recall on top of them.
      </p>
      <p>
        We recommend <strong>Matrix Memory</strong>. It is the only provider
        that is bundled, has its dependencies already installed, and needs no
        key, no account and no external service — it stores everything in one
        SQLite file under <code>~/.hermes</code> using the Mnemosyne engine.
        Despite the name it has nothing to do with the Matrix chat protocol:
        there is no homeserver, no federation and no network call of any kind.
      </p>
      {/* `warn`, not `error`: a config read that failed means we cannot show
          what is running, not that memory is broken. */}
      {error ? <WizardNote tone="warn">{error}</WizardNote> : null}
      {loading ? <p>Loading memory providers…</p> : null}
      {activeProvider ? (
        <WizardNote tone="warn">
          Each provider owns its own store. Switching changes which one the
          agent loads — nothing is deleted, but memories already recorded do not
          carry across to the new provider.
        </WizardNote>
      ) : null}
      <MemoryPicker
        choices={choices}
        activeId={activeProvider}
        onSelect={onSelect}
        selecting={selecting}
        canWrite={canWrite}
        stats={stats}
      />
      {touched && needsRestart ? (
        <>
          <div className="ob-restart-notice">
            <span>
              The memory provider is read once, when the Hermes gateway starts —
              so this change does not take effect until the gateway restarts.
            </span>
          </div>
          <div className="ob-cli">hermes gateway restart</div>
        </>
      ) : null}
    </WizardPanel>
  )
}
