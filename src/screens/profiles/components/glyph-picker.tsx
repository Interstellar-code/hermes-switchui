import { useMemo } from 'react'

type GlyphPickerProps = {
  value: string
  onChange: (v: string) => void
  name?: string
  role?: string
}

function genSuggestions(name: string, role: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  function add(s: string) {
    const v = s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3)
    if (v.length >= 1 && !seen.has(v)) { seen.add(v); out.push(v) }
  }

  // First 1, 2, 3 chars of name
  if (name) {
    add(name.slice(0, 1))
    add(name.slice(0, 2))
    add(name.slice(0, 3))
  }

  // Initials of role words
  if (role) {
    const words = role.trim().split(/\s+/).filter(Boolean)
    if (words.length >= 2) {
      add(words.map((w) => w[0]).join('').slice(0, 3))
      add(words.map((w) => w[0]).join('').slice(0, 2))
    }
    if (words[0]) add(words[0].slice(0, 2))
  }

  // Some random 2-char alphanumeric suggestions based on hashing name+role
  const seed = (name + role).split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
  for (let i = 0; i < 5; i++) {
    const a = CHARS[(seed * (i + 3) * 7919) % CHARS.length]
    const b = CHARS[(seed * (i + 7) * 6271) % CHARS.length]
    add(a + b)
  }

  return out.slice(0, 12)
}

export function GlyphPicker({ value, onChange, name = '', role = '' }: GlyphPickerProps) {
  const suggestions = useMemo(() => genSuggestions(name, role), [name, role])

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3)
    onChange(v)
  }

  return (
    <div className="glyph-picker-wrap">
      <input
        className="wiz-input"
        value={value}
        onChange={handleInput}
        placeholder="e.g. TS"
        maxLength={3}
        style={{ fontFamily: 'var(--m-font-mono, ui-monospace, monospace)', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', width: '100%' }}
      />
      {suggestions.length > 0 && (
        <div className="glyph-pick" style={{ marginTop: 10 }}>
          {suggestions.map((g) => (
            <button
              key={g}
              type="button"
              className={`glyph-opt${value === g ? ' on' : ''}`}
              onClick={() => onChange(g)}
            >
              {g}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
