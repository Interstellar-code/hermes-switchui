'use client'

/**
 * profile-picker.tsx — one card per agent profile, with an Activate control on
 * every card that is not the live one.
 *
 * Not a `WizardPick` grid: picking a provider stages a value in the draft that
 * the review step later writes, whereas activating a profile *is* the write —
 * it happens on click, against `~/.hermes/active_profile`. Presenting it as a
 * selection would promise a Save that does not exist. It does reuse the
 * provider grid's state grammar (`.ob-badge-active`, the accent outline on
 * `.is-active`) so "this is the one you are running" reads identically on both
 * steps.
 */
import type { ProfileChoice } from '../lib/profile-choices'

export type ProfilePickerProps = {
  choices: Array<ProfileChoice>
  activeName: string | null
  onActivate: (name: string) => void
  activating: string | null
  /**
   * The `canWriteConfig` verdict. A locked relaunch renders no activate
   * control at all — absent rather than disabled, matching how the plugins
   * step withholds its toggles, because a greyed-out button still reads as
   * "almost allowed".
   */
  canWrite: boolean
}

function ProfileCard({
  choice,
  busy,
  onActivate,
  canWrite,
}: {
  choice: ProfileChoice
  busy: boolean
  onActivate: (name: string) => void
  canWrite: boolean
}) {
  return (
    <li className={`ob-profile${choice.isActive ? ' is-active' : ''}`}>
      {/* Decorative: the monogram repeats the name that follows it. */}
      <span className="ob-profile-glyph" aria-hidden="true">
        {choice.glyph}
      </span>
      <div className="ob-profile-body">
        <p className="ob-profile-name">
          {choice.label}
          {choice.isActive ? (
            <span className="ob-badge ob-badge-active">Active</span>
          ) : null}
          {choice.tier !== null ? (
            <span className={`ob-tier is-t${choice.tier}`}>
              Tier {choice.tier}
            </span>
          ) : null}
        </p>
        {choice.role ? <p className="ob-profile-role">{choice.role}</p> : null}
        {choice.description ? (
          <p className="ob-profile-desc">{choice.description}</p>
        ) : null}
        {choice.model ? (
          <p className="ob-profile-meta">Model {choice.model}</p>
        ) : null}
      </div>
      {choice.isActive ? (
        // The pill above carries the state visually; this carries it for a
        // reader that never sees the accent outline.
        <span className="wz-sr">Currently the active profile.</span>
      ) : null}
      {!choice.isActive && canWrite ? (
        <button
          type="button"
          className="wz-btn"
          disabled={busy}
          // Named, not bare "Activate" — a column of identical accessible
          // names tells a screen-reader user nothing about which row they are
          // on.
          aria-label={`Activate ${choice.label}`}
          onClick={() => onActivate(choice.name)}
        >
          {busy ? 'Activating…' : 'Activate'}
        </button>
      ) : null}
    </li>
  )
}

export function ProfilePicker({
  choices,
  activeName,
  onActivate,
  activating,
  canWrite,
}: ProfilePickerProps) {
  return (
    <>
      <ul className="ob-profiles">
        {choices.map((choice) => (
          <ProfileCard
            key={choice.name}
            // `activeName` is the caller's answer and wins over the row's own
            // flag, so an optimistic refetch cannot briefly mark two cards.
            choice={
              activeName === null
                ? choice
                : { ...choice, isActive: choice.name === activeName }
            }
            busy={activating === choice.name}
            onActivate={onActivate}
            canWrite={canWrite}
          />
        ))}
      </ul>
      {!canWrite ? (
        <p className="ob-profile-meta">
          Read-only for this run — switching profiles is a write, so choose
          &ldquo;Change setup&rdquo; on the summary first.
        </p>
      ) : null}
    </>
  )
}
