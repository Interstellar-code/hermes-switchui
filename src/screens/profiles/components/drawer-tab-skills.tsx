import { useState } from 'react'
import type { SkillsConfig, AgentRuntime } from '@/server/profiles-browser'

const ALL_TOOLSETS = ['core', 'files', 'web', 'bash', 'terminal', 'vision'] as const

type Props = {
  skillDirs: string[]
  maxTurns: number
  reasoningEffort: 'low' | 'medium' | 'high'
  disabledToolsets: string[]
  readonly: boolean
  onSave: (patch: { skills?: SkillsConfig; agent?: Partial<AgentRuntime> }) => Promise<void>
}

export function DrawerTabSkills({ skillDirs, maxTurns, reasoningEffort, disabledToolsets, readonly, onSave }: Props) {
  const [dirs, setDirs] = useState<string[]>(skillDirs)
  const [dirInput, setDirInput] = useState('')
  const [turns, setTurns] = useState(maxTurns)
  const [effort, setEffort] = useState<'low' | 'medium' | 'high'>(reasoningEffort)
  const [disabled, setDisabled] = useState<string[]>(disabledToolsets)
  const [busy, setBusy] = useState(false)

  const dirty =
    JSON.stringify(dirs) !== JSON.stringify(skillDirs) ||
    turns !== maxTurns ||
    effort !== reasoningEffort ||
    JSON.stringify([...disabled].sort()) !== JSON.stringify([...disabledToolsets].sort())

  function toggleToolset(name: string) {
    setDisabled((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name],
    )
  }

  function addDir() {
    const d = dirInput.trim()
    if (d && !dirs.includes(d)) setDirs([...dirs, d])
    setDirInput('')
  }

  function removeDir(dir: string) {
    setDirs(dirs.filter((d) => d !== dir))
  }

  async function handleSave() {
    setBusy(true)
    try {
      await onSave({
        skills: { external_dirs: dirs },
        agent: { max_turns: turns, reasoning_effort: effort, disabled_toolsets: disabled },
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {/* Toolsets section */}
      <div style={{ marginBottom: 24 }}>
        <p className="pf-drawer-section-title">Toolsets</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {ALL_TOOLSETS.map((ts) => {
            const enabled = !disabled.includes(ts)
            return (
              <button
                key={ts}
                type="button"
                className={`skill${enabled ? ' on' : ''}`}
                onClick={() => !readonly && toggleToolset(ts)}
                style={{ cursor: readonly ? 'default' : 'pointer', opacity: readonly ? .7 : 1, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <div className="chk" />
                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{ts}</span>
              </button>
            )
          })}
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 10, opacity: .5, marginBottom: 4 }}>
          Unchecked toolsets are added to <code>disabled_toolsets</code>.
        </div>
      </div>

      {/* Skill Directories section */}
      <div style={{ marginBottom: 24 }}>
        <p className="pf-drawer-section-title">Skill Directories</p>
        <div className="wiz-info-note" style={{ marginBottom: 14, display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 12px', background: 'var(--m-bg-deep,#000802)', border: '1px solid var(--m-border,var(--theme-border))', borderRadius: 6, fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6, color: 'var(--m-text-faint,var(--theme-muted))' }}>
          The profile's own <code>skills/</code> directory is always scanned. These are extra shared paths.
        </div>

        {dirs.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
            {dirs.map((dir) => (
              <div key={dir} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'var(--m-bg-deep,#000802)', border: '1px solid var(--m-border,var(--theme-border))', borderRadius: 5 }}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: 11, height: 11, flexShrink: 0, color: 'var(--m-text-faint,var(--theme-muted))' }}>
                  <path d="M2 4h4l1.5 2H14v7H2z"/>
                </svg>
                <span style={{ fontFamily: 'monospace', fontSize: 11, flex: 1, wordBreak: 'break-all' }}>{dir}</span>
                {!readonly && (
                  <button
                    type="button"
                    onClick={() => removeDir(dir)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--m-text-faint,var(--theme-muted))', padding: 0, display: 'flex', alignItems: 'center' }}
                    aria-label={`Remove ${dir}`}
                  >
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 10, height: 10 }}>
                      <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontFamily: 'monospace', fontSize: 11, opacity: .45, marginBottom: 10 }}>No extra directories</div>
        )}

        {!readonly && (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="pf-drawer-input"
              style={{ flex: 1 }}
              value={dirInput}
              onChange={(e) => setDirInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDir() } }}
              placeholder="/path/to/shared/skills"
            />
            <button type="button" className="pf-drawer-action-btn primary" onClick={addDir} disabled={!dirInput.trim()}>
              Add
            </button>
          </div>
        )}
      </div>

      {/* Advanced */}
      <div style={{ marginBottom: 24 }}>
        <p className="pf-drawer-section-title">Advanced</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--m-text-faint,var(--theme-muted))', display: 'block', marginBottom: 6 }}>
              Max Turns
            </label>
            <input
              type="number"
              className="pf-drawer-input"
              style={{ width: 100 }}
              value={turns}
              onChange={(e) => setTurns(Number(e.target.value))}
              min={1}
              max={500}
              disabled={readonly}
            />
          </div>
          <div>
            <label style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--m-text-faint,var(--theme-muted))', display: 'block', marginBottom: 6 }}>
              Reasoning Effort
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['low', 'medium', 'high'] as const).map((e) => (
                <button
                  key={e}
                  type="button"
                  className={`wiz-effort-btn${effort === e ? ' on' : ''}`}
                  onClick={() => !readonly && setEffort(e)}
                  style={{ opacity: readonly ? .5 : 1, cursor: readonly ? 'not-allowed' : 'pointer' }}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {!readonly && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="pf-drawer-btn-save" onClick={() => void handleSave()} disabled={!dirty || busy}>
            {busy ? 'Saving…' : 'Save Changes'}
          </button>
          {dirty && (
            <button type="button" className="pf-drawer-btn-cancel" onClick={() => { setDirs(skillDirs); setTurns(maxTurns); setEffort(reasoningEffort); setDisabled(disabledToolsets) }}>
              Reset
            </button>
          )}
        </div>
      )}
    </div>
  )
}
