'use client'

export interface ProfileScopeSelectProps {
  value: string
  onChange: (profile: string) => void
  profiles: Array<string>
}

export function ProfileScopeSelect({ value, onChange, profiles }: ProfileScopeSelectProps) {
  if (profiles.length === 0) return null

  return (
    <select
      className="si-profile-scope-select"
      value={value}
      aria-label="Active profile"
      onChange={(e) => onChange(e.target.value)}
    >
      {profiles.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  )
}
