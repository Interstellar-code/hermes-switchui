import { useState } from 'react'
import type { NewAgentDraft } from '../types'

type Props = {
  draft: NewAgentDraft
  errors: string[]
  onChange: (patch: Partial<NewAgentDraft>) => void
}

export function WizardStepSkills({ draft, errors, onChange }: Props) {
  const [dirInput, setDirInput] = useState('')
  const [pathError, setPathError] = useState<string | null>(null)

  function addDir() {
    const d = dirInput.trim()
    if (!d) return
    if (!d.startsWith('/') && !d.startsWith('~/')) {
      setPathError('Path must be absolute (start with / or ~/)')
      return
    }
    setPathError(null)
    if (!draft.skill_dirs.includes(d)) {
      onChange({ skill_dirs: [...draft.skill_dirs, d] })
    }
    setDirInput('')
  }

  function removeDir(dir: string) {
    onChange({ skill_dirs: draft.skill_dirs.filter((d) => d !== dir) })
  }

  return (
    <div>
      <h3>Skills</h3>
      <p className="lead">
        Add extra shared skill directories. The agent's own{' '}
        <code>skills/</code> folder is always scanned — these are additional
        shared paths visible across multiple agents.
      </p>

      {errors.length > 0 && (
        <div className="wiz-errors">
          {errors.map((e) => (
            <div key={e} className="wiz-error">{e}</div>
          ))}
        </div>
      )}

      <div className="wiz-info-note">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="8" cy="8" r="6.5"/>
          <line x1="8" y1="7" x2="8" y2="11"/>
          <circle cx="8" cy="5" r=".5" fill="currentColor" stroke="none"/>
        </svg>
        The profile's own <code>skills/</code> directory is always scanned — these are{' '}
        <em>additional</em> shared paths.
      </div>

      {/* Existing dirs */}
      {draft.skill_dirs.length > 0 && (
        <div className="skill-dir-list" style={{ marginBottom: 16 }}>
          {draft.skill_dirs.map((dir) => (
            <div key={dir} className="skill-dir-chip">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: 12, height: 12, flexShrink: 0 }}>
                <path d="M2 4h4l1.5 2H14v7H2z"/>
              </svg>
              <span>{dir}</span>
              <button type="button" className="wiz-tag-x" onClick={() => removeDir(dir)}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add input */}
      <div className="field">
        <label>Add Directory</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="wiz-input"
            style={{ flex: 1 }}
            value={dirInput}
            onChange={(e) => setDirInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addDir() }
            }}
            placeholder="/Users/me/.hermes-shared/skills"
          />
          <button
            type="button"
            className="wiz-btn-secondary"
            onClick={addDir}
            disabled={!dirInput.trim()}
          >
            Add
          </button>
        </div>
        <div className="wiz-hint">Press Enter or click Add. The gateway resolves paths relative to the host.</div>
      </div>
    </div>
  )
}
