'use client'

import { useState } from 'react'

// ── Glossary ──────────────────────────────────────────────────────────────────

export const GLOSSARY: Record<string, string> = {
  offline:
    'Score from a fixed scenario set, run before going live. Cheap, repeatable.',
  live:
    'Score from real sessions after the edit is applied.',
  holdout:
    'Scenarios hidden from the proposer so it can\'t game them — a fairness check.',
  ratchet:
    'An edit is kept only if it scores better; the baseline only moves up.',
  'atomic edit':
    'One small change (ideally a single sentence) so wins/losses are attributable.',
  'proposer vs judge':
    'A different model proposes the edit than the one that grades it — anti-gaming.',
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface InfoTooltipProps {
  /** One of the GLOSSARY keys */
  term: string
  /** Override display label (defaults to `term`) */
  label?: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export function InfoTooltip({ term, label }: InfoTooltipProps) {
  const [visible, setVisible] = useState(false)
  const copy = GLOSSARY[term] ?? term

  return (
    <span className="si-tooltip-wrap">
      <button
        type="button"
        className="si-tooltip-trigger"
        aria-label={`What is ${term}?`}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
      >
        {label ?? term}
        <span className="si-tooltip-icon" aria-hidden>ⓘ</span>
      </button>
      {visible && (
        <span className="si-tooltip-bubble" role="tooltip">
          {copy}
        </span>
      )}
    </span>
  )
}
