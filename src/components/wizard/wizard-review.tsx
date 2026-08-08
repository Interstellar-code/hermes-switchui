'use client'

/**
 * wizard-review.tsx — "here is exactly what the Save button will write".
 *
 * It takes strings and nothing else: no YAML, no provider shapes, no config
 * schema. The caller renders its own preview and hands it over verbatim, which
 * is what lets the crons and agent wizards reuse this without teaching it a
 * third file format. The preview is printed as-is inside a `<pre>` so what the
 * user reads is byte-for-byte what gets written.
 */
import type { ReactNode } from 'react'

export type WizardReviewProps = {
  /** Where the preview lands, e.g. `~/.hermes/config.yaml`. */
  target: string
  /** Rendered verbatim — no escaping, no reformatting. */
  preview: string
  /** Secondary writes, e.g. the `.env` line for an API key. */
  extras?: Array<{ target: string; preview: string }>
  notes?: Array<{ tone: 'info' | 'warn' | 'error' | 'ok'; text: ReactNode }>
}

const TONE_CLASS = {
  info: '',
  warn: ' wz-warn',
  error: ' wz-err',
  ok: ' wz-ok',
} as const

export function WizardReview({
  target,
  preview,
  extras = [],
  notes = [],
}: WizardReviewProps) {
  return (
    <div className="wz-review">
      {[{ target, preview }, ...extras].map((entry, index) => (
        <section key={`${entry.target}-${index}`} className="wz-review-entry">
          <p className="wz-review-target">{entry.target}</p>
          <pre className="wz-diff">{entry.preview}</pre>
        </section>
      ))}
      {notes.map((note, index) => (
        <div key={index} className={`wz-note${TONE_CLASS[note.tone]}`}>
          {note.text}
        </div>
      ))}
    </div>
  )
}
