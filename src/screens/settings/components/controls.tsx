/**
 * controls.tsx — Primitive setting controls for the Settings screen.
 * Toggle, Segmented, NumberSlider, PasswordField
 *
 * `id` and `aria-labelledby` on each component below are filled in by
 * `SettingRow`, which clones its sole child with those two props so the row's
 * `<label>` names whatever control it wraps. Both are optional so every
 * existing call site — none of which passes them today — is unaffected.
 */

import { useState } from 'react'
import type { KeyboardEvent } from 'react'

// ── Toggle ────────────────────────────────────────────────────────────────

type ToggleProps = {
  on: boolean
  set: (v: boolean) => void
  disabled?: boolean
  id?: string
  'aria-labelledby'?: string
}

export function Toggle({
  on,
  set,
  disabled,
  id,
  'aria-labelledby': ariaLabelledBy,
}: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      id={id}
      aria-labelledby={ariaLabelledBy}
      disabled={disabled}
      className={`toggle${on ? ' on' : ''}`}
      onClick={() => set(!on)}
    />
  )
}

// ── Segmented ─────────────────────────────────────────────────────────────

type SegmentedProps = {
  options: Array<{ value: string; label: string }>
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  id?: string
  'aria-labelledby'?: string
}

/**
 * A plain button row with no `role` used to announce each option as a bare
 * "button" and nothing tied them together as a single choice. This follows
 * the ARIA APG radiogroup pattern: the wrapper is `role="radiogroup"`, each
 * option is `role="radio"` + `aria-checked`, and only the selected option is
 * in the Tab order — arrow keys (and Home/End) move both focus and the
 * selection between options, matching native radio-button behaviour.
 */
export function Segmented({
  options,
  value,
  onChange,
  disabled,
  id,
  'aria-labelledby': ariaLabelledBy,
}: SegmentedProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled || options.length === 0) return
    const currentIndex = options.findIndex((opt) => opt.value === value)
    let nextIndex = currentIndex

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (currentIndex + 1 + options.length) % options.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (currentIndex - 1 + options.length) % options.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = options.length - 1
        break
      default:
        return
    }

    event.preventDefault()
    const next = options[nextIndex]
    onChange(next.value)
    const nextButton = event.currentTarget.children[nextIndex] as HTMLElement | undefined
    nextButton?.focus()
  }

  // If `value` doesn't match any option (unset, or a value this control
  // doesn't render), fall back the roving tab stop to the first option so
  // the group is never entirely un-tabbable.
  const hasSelection = options.some((opt) => opt.value === value)

  return (
    <div
      className="segmented"
      role="radiogroup"
      id={id}
      aria-labelledby={ariaLabelledBy}
      onKeyDown={handleKeyDown}
    >
      {options.map((opt, index) => {
        const selected = value === opt.value
        const isTabStop = selected || (!hasSelection && index === 0)
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={isTabStop ? 0 : -1}
            className={`seg-opt${selected ? ' on' : ''}`}
            onClick={() => onChange(opt.value)}
            disabled={disabled}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// ── NumberSlider ──────────────────────────────────────────────────────────

type NumberSliderProps = {
  min: number
  max: number
  step?: number
  value: number
  onChange: (v: number) => void
  disabled?: boolean
  id?: string
  'aria-labelledby'?: string
}

/**
 * Two inputs, one value, previously zero accessible names on either — a
 * screen reader announced "slider" and "spin button" with nothing to tell
 * them apart from any other pair on the page. `id` (from `SettingRow`) names
 * the range input, the row's actual `<label htmlFor>` target; the number
 * input can't also own that id, so it gets the same `aria-labelledby`
 * instead — both end up with the row's label as their accessible name.
 */
export function NumberSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
  disabled,
  id,
  'aria-labelledby': ariaLabelledBy,
}: NumberSliderProps) {
  return (
    <div className="num-slider">
      <input
        type="range"
        id={id}
        aria-labelledby={ariaLabelledBy}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <input
        type="number"
        aria-labelledby={ariaLabelledBy}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

// ── PasswordField ─────────────────────────────────────────────────────────

type PasswordFieldProps = {
  value: string
  masked?: boolean
  onReveal?: () => void
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  id?: string
  'aria-labelledby'?: string
}

function IconEye({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" strokeLinecap="round"/>
        <circle cx="8" cy="8" r="2"/>
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M2 2l12 12M6.5 6.6A2 2 0 0 0 9.4 9.5M4.2 4.3C2.5 5.4 1 8 1 8s2.5 5 7 5a7 7 0 0 0 3.8-1.2" strokeLinecap="round"/>
      <path d="M11.5 11.6C13.3 10.5 15 8 15 8s-2.5-5-7-5c-.7 0-1.4.1-2 .3" strokeLinecap="round"/>
    </svg>
  )
}

export function PasswordField({
  value,
  masked = true,
  onReveal,
  onChange,
  placeholder,
  disabled,
  id,
  'aria-labelledby': ariaLabelledBy,
}: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(!masked)

  function handleReveal() {
    setRevealed((v) => !v)
    onReveal?.()
  }

  return (
    <div className="pw-wrap">
      <input
        type={revealed ? 'text' : 'password'}
        id={id}
        aria-labelledby={ariaLabelledBy}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="eye-btn" onClick={handleReveal} aria-label="Toggle visibility">
        <IconEye open={revealed} />
      </button>
    </div>
  )
}
