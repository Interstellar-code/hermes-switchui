'use client'

/**
 * memory-picker.tsx — one card per memory provider, with a Use control on
 * every card that is not the live one.
 *
 * Same shape as `profile-picker.tsx`, and for the same reason: picking here
 * *is* the write (a `PATCH` against `~/.hermes/config.yaml`), not a value
 * staged for a later Save, so presenting it as a `WizardPick` selection would
 * promise a Save that does not exist. It reuses the provider grid's state
 * grammar — `.ob-badge-active` plus the accent outline on `.is-active` — so
 * "this is the one you are running" reads identically on every step.
 *
 * Every state a colour carries is also carried in text: the readiness pill has
 * a word, not just a hue, and the active card names its state in the card body
 * rather than relying on the outline.
 */
import type { MemoryChoice, MemoryStatus } from '../lib/memory-choices'
import type { MemoryStoreStats } from '../hooks/use-onboarding-memory'

export type MemoryPickerProps = {
  choices: Array<MemoryChoice>
  activeId: string | null
  onSelect: (id: string) => void
  selecting: string | null
  /**
   * The `canWriteConfig` verdict. A locked relaunch renders no select control
   * at all — absent rather than disabled, matching how the plugins and profile
   * steps withhold theirs, because a greyed-out button still reads as
   * "almost allowed".
   */
  canWrite: boolean
  /** The recommended provider's store, when it could be read. */
  stats?: MemoryStoreStats | null
}

const STATUS_CLASS: Record<MemoryStatus, string> = {
  ready: 'is-ready',
  'needs-config': 'is-needs-config',
  unavailable: 'is-unavailable',
  missing: 'is-missing',
  unknown: 'is-unknown',
}

const STATUS_LABEL: Record<MemoryStatus, string> = {
  ready: 'Ready',
  'needs-config': 'Needs setup',
  unavailable: 'Unavailable',
  missing: 'Not installed',
  // Not a failure: the dashboard that answers the readiness question is a
  // separate process, and it is routinely not running.
  unknown: "Couldn't check",
}

/** The pill colour is a second channel; this is the sentence behind it. */
const STATUS_SENTENCE: Record<MemoryStatus, string> = {
  ready: 'Ready to use.',
  'needs-config': 'Installed, but still needs configuring.',
  unavailable: 'Installed, but its dependencies are not.',
  missing: 'Not installed on this machine.',
  unknown: 'Readiness could not be checked on this machine.',
}

function MemoryCard({
  choice,
  busy,
  onSelect,
  canWrite,
  stats,
}: {
  choice: MemoryChoice
  busy: boolean
  onSelect: (id: string) => void
  canWrite: boolean
  stats: MemoryStoreStats | null
}) {
  // Only meaningful for the local store this workspace can actually read, and
  // only worth saying when there is something in it.
  const showStore =
    choice.recommended && stats !== null && stats.exists && stats.total > 0

  return (
    <li className={`ob-memory-card${choice.isActive ? ' is-active' : ''}`}>
      <div className="ob-memory-body">
        <p className="ob-memory-name">
          {choice.label}
          {choice.isActive ? (
            <span className="ob-badge ob-badge-active">Active</span>
          ) : null}
          {choice.recommended ? (
            <span className="ob-badge ob-badge-recommended">Recommended</span>
          ) : null}
          <span className={`ob-memory-state ${STATUS_CLASS[choice.status]}`}>
            {STATUS_LABEL[choice.status]}
          </span>
        </p>
        <p className="ob-memory-desc">{choice.desc}</p>
        {choice.requirement ? (
          <p className="ob-memory-req">{choice.requirement}</p>
        ) : null}
        {showStore ? (
          <p className="ob-memory-req">
            Its store already exists here, holding {stats.total}{' '}
            {stats.total === 1 ? 'entry' : 'entries'}.
          </p>
        ) : null}
        {/* The pills above carry these visually; this carries them for a
            reader that never sees the outline or the hue. */}
        <span className="wz-sr">
          {choice.isActive ? 'Currently the active memory provider. ' : ''}
          {STATUS_SENTENCE[choice.status]}
        </span>
      </div>
      {!choice.isActive && canWrite ? (
        <button
          type="button"
          className="wz-btn"
          disabled={busy}
          // Named, not bare "Use" — a column of identical accessible names
          // tells a screen-reader user nothing about which row they are on.
          aria-label={`Use ${choice.label}`}
          onClick={() => onSelect(choice.id)}
        >
          {busy ? 'Switching…' : 'Use this'}
        </button>
      ) : null}
    </li>
  )
}

export function MemoryPicker({
  choices,
  activeId,
  onSelect,
  selecting,
  canWrite,
  stats = null,
}: MemoryPickerProps) {
  return (
    <>
      <ul className="ob-memory">
        {choices.map((choice) => (
          <MemoryCard
            key={choice.id}
            // `activeId` is the caller's answer and wins over the row's own
            // flag, so an optimistic refetch cannot briefly mark two cards.
            choice={
              activeId === null
                ? choice
                : { ...choice, isActive: choice.id === activeId }
            }
            busy={selecting === choice.id}
            onSelect={onSelect}
            canWrite={canWrite}
            stats={stats}
          />
        ))}
      </ul>
      {!canWrite ? (
        <p className="ob-memory-req">
          Read-only for this run — switching the memory provider rewrites
          config.yaml, so choose &ldquo;Change setup&rdquo; on the summary
          first.
        </p>
      ) : null}
    </>
  )
}
