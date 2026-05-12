/**
 * controls.tsx — Primitive setting controls for the Settings screen.
 * Toggle, Segmented, NumberSlider, PasswordField
 */

import { useState } from 'react'

// ── Toggle ────────────────────────────────────────────────────────────────

type ToggleProps = {
  on: boolean
  set: (v: boolean) => void
  disabled?: boolean
}

export function Toggle({ on, set, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
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
}

export function Segmented({ options, value, onChange, disabled }: SegmentedProps) {
  return (
    <div className="segmented">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`seg-opt${value === opt.value ? ' on' : ''}`}
          onClick={() => onChange(opt.value)}
          disabled={disabled}
        >
          {opt.label}
        </button>
      ))}
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
}

export function NumberSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
  disabled,
}: NumberSliderProps) {
  return (
    <div className="num-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <input
        type="number"
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
