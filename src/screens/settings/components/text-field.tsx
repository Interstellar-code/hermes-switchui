/**
 * text-field.tsx — typed wrapper for the raw `<input className="text-input">`
 * the settings sections use today (see section-gateway.tsx host/port rows).
 * Same class and controlled-value contract, plus `id` / `aria-labelledby` so
 * `SettingRow`'s auto-naming clone can name it, exactly like the controls in
 * controls.tsx. `type` defaults to 'text'; sections that used
 * `<input type="number" className="text-input">` pass 'number' and keep their
 * own validation on top of the value they receive.
 */

type TextFieldProps = {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  type?: 'text' | 'number' | 'password'
  id?: string
  'aria-labelledby'?: string
}

export function TextField({
  value,
  onChange,
  placeholder,
  disabled,
  type = 'text',
  id,
  'aria-labelledby': ariaLabelledBy,
}: TextFieldProps) {
  return (
    <input
      type={type}
      className="text-input"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      id={id}
      aria-labelledby={ariaLabelledBy}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
