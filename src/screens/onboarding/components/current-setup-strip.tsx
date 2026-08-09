'use client'

/**
 * current-setup-strip.tsx — the one-or-two-line "here is what is already true"
 * band every wizard step body leads with.
 *
 * It is context, not content: a compact `<dl>` of label/value pairs, never a
 * panel and never more than a couple of lines. On a genuinely fresh install
 * `factsForStep` returns `[]` and this renders *nothing* — an empty
 * "Currently configured" box on a first run would be worse than no box at all.
 */
import type { SetupFact } from '../lib/current-setup'

export type CurrentSetupStripProps = {
  facts: Array<SetupFact>
  heading?: string
}

const STATE_CLASS: Record<SetupFact['state'], string> = {
  active: 'is-active',
  set: 'is-set',
  unset: 'is-unset',
}

export function CurrentSetupStrip({
  facts,
  heading = 'Currently configured',
}: CurrentSetupStripProps) {
  if (facts.length === 0) return null

  return (
    <section className="ob-current" aria-label={heading}>
      <p className="ob-current-heading">{heading}</p>
      <dl className="ob-current-facts">
        {facts.map((entry) => (
          <div className="ob-current-fact" key={entry.id}>
            <dt className="ob-current-label">{entry.label}</dt>
            <dd className={`ob-current-value ${STATE_CLASS[entry.state]}`}>
              {entry.value}
              {/* The green dot is drawn in CSS, so the "active" half of this
                  signal would otherwise exist only as a colour. */}
              {entry.state === 'active' ? (
                <span className="wz-sr"> — active</span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
