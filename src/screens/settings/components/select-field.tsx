/**
 * select-field.tsx — typed wrapper for the raw `<select className="select-input">`
 * the settings sections use today (see section-agent-runtime.tsx /
 * section-gateway.tsx). Same class, same controlled-value contract, plus:
 *
 *  - `id` / `aria-labelledby` so `SettingRow`'s auto-naming clone can name it,
 *    exactly like Toggle/Segmented/NumberSlider/PasswordField in controls.tsx.
 *  - an unknown current value (present in the config but not among `options`,
 *    e.g. a backend the UI doesn't know) stays visible instead of silently
 *    snapping to the first option, rendered as "<value> (not offered here)".
 *    An empty string means "no value yet": it gets a blank placeholder option
 *    so the displayed selection is blank too, instead of the browser showing
 *    the first option while the state says unset.
 */

type SelectFieldProps = {
  options: Array<{ value: string; label: string }>
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  id?: string
  'aria-labelledby'?: string
}

export function SelectField({
  options,
  value,
  onChange,
  disabled,
  id,
  'aria-labelledby': ariaLabelledBy,
}: SelectFieldProps) {
  const known = options.some((opt) => opt.value === value)

  return (
    <select
      className="select-input"
      value={value}
      disabled={disabled}
      id={id}
      aria-labelledby={ariaLabelledBy}
      onChange={(e) => onChange(e.target.value)}
    >
      {!known && value === '' && <option value="" />}
      {!known && value !== '' && (
        <option value={value}>{`${value} (not offered here)`}</option>
      )}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}
