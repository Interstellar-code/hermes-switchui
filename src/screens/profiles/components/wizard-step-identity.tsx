import { useState } from 'react'
import { GlyphPicker } from './glyph-picker'
import type { NewAgentDraft } from '../types'

type Props = {
  draft: NewAgentDraft
  errors: string[]
  existingTags: string[]
  onChange: (patch: Partial<NewAgentDraft>) => void
}

export function WizardStepIdentity({ draft, errors, existingTags, onChange }: Props) {
  const [tagInput, setTagInput] = useState('')

  function addTag(tag: string) {
    const t = tag.trim().toLowerCase()
    if (t && !draft.tags.includes(t)) {
      onChange({ tags: [...draft.tags, t] })
    }
    setTagInput('')
  }

  function removeTag(tag: string) {
    onChange({ tags: draft.tags.filter((t) => t !== tag) })
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(tagInput)
    } else if (e.key === 'Backspace' && !tagInput && draft.tags.length > 0) {
      removeTag(draft.tags[draft.tags.length - 1])
    }
  }

  const suggestions = existingTags.filter(
    (t) => tagInput && t.includes(tagInput.toLowerCase()) && !draft.tags.includes(t),
  ).slice(0, 6)

  return (
    <div>
      <h3>Identity</h3>
      <p className="lead">Define the agent's slug, display role, and visual glyph.</p>

      {errors.length > 0 && (
        <div className="wiz-errors">
          {errors.map((e) => (
            <div key={e} className="wiz-error">{e}</div>
          ))}
        </div>
      )}

      <div className="field">
        <label>
          Name <span className="opt">(slug — lowercase, hyphens)</span>
        </label>
        <input
          className="wiz-input"
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
          placeholder="my-agent"
          maxLength={40}
        />
        <div className="wiz-hint">2–40 chars · lowercase letters, numbers, hyphens only</div>
      </div>

      <div className="field">
        <label>Role <span className="opt">(≤80 chars)</span></label>
        <input
          className="wiz-input"
          value={draft.role}
          onChange={(e) => onChange({ role: e.target.value.slice(0, 80) })}
          placeholder="TypeScript Architect"
          maxLength={80}
        />
        <div className="wiz-hint">{80 - draft.role.length} chars remaining</div>
      </div>

      <div className="field">
        <label>Glyph <span className="opt">(1–3 uppercase chars)</span></label>
        <GlyphPicker
          value={draft.glyph}
          onChange={(g) => onChange({ glyph: g })}
          name={draft.name}
          role={draft.role}
        />
      </div>

      <div className="field">
        <label>Tags <span className="opt">(optional · press Enter or comma)</span></label>
        <div className="wiz-tag-input-wrap">
          {draft.tags.map((t) => (
            <span key={t} className="wiz-tag-chip">
              {t}
              <button type="button" className="wiz-tag-x" onClick={() => removeTag(t)}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>
                </svg>
              </button>
            </span>
          ))}
          <input
            className="wiz-tag-inner"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            onBlur={() => { if (tagInput) addTag(tagInput) }}
            placeholder={draft.tags.length === 0 ? 'typescript, review…' : ''}
          />
        </div>
        {suggestions.length > 0 && (
          <div className="wiz-tag-suggestions">
            {suggestions.map((s) => (
              <button key={s} type="button" className="wiz-tag-suggestion" onClick={() => addTag(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
