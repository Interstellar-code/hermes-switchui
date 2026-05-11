import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { NewAgentDraft } from '../types'

type PersonaListItem = {
  id: string
  category: string
  glyph: string
  name: string
  description: string
  tags: string[]
  system_prompt_preview: string
  has_more_prompt: boolean
}

type Props = {
  draft: NewAgentDraft
  errors: string[]
  onChange: (patch: Partial<NewAgentDraft>) => void
}

async function fetchPersonas(): Promise<PersonaListItem[]> {
  const r = await fetch('/api/personas/list')
  if (!r.ok) throw new Error('Failed to load personas')
  const data = (await r.json()) as { personas: PersonaListItem[] }
  return data.personas
}

async function fetchPersonaPrompt(id: string): Promise<string> {
  const r = await fetch(`/api/personas/read?id=${encodeURIComponent(id)}`)
  if (!r.ok) throw new Error('Failed to load persona')
  const data = (await r.json()) as { persona: { system_prompt: string } }
  return data.persona.system_prompt
}

export function WizardStepPersona({ draft, errors, onChange }: Props) {
  const [activeCat, setActiveCat] = useState('all')
  const [search, setSearch] = useState('')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)

  const personasQuery = useQuery({
    queryKey: ['personas', 'list'],
    queryFn: fetchPersonas,
    staleTime: 60_000,
  })

  const personas = personasQuery.data ?? []

  // Build category counts
  const catCounts: Record<string, number> = {}
  for (const p of personas) {
    catCounts[p.category] = (catCounts[p.category] ?? 0) + 1
  }
  const categories = Object.keys(catCounts).sort()

  const filtered = personas.filter((p) => {
    if (activeCat !== 'all' && p.category !== activeCat) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
      )
    }
    return true
  })

  async function pickPersona(p: PersonaListItem) {
    if (draft.persona_id === p.id) return
    setLoadingId(p.id)
    setPickError(null)
    try {
      const prompt = await fetchPersonaPrompt(p.id)
      onChange({
        persona_id: p.id,
        system_prompt: prompt,
        glyph: draft.glyph || p.glyph,
        role: draft.role || p.name,
      })
    } catch {
      setPickError(`Failed to load persona "${p.name}". Please try again.`)
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <div>
      <h3>Persona</h3>
      <p className="lead">
        Pick a curated persona — its system prompt will be snapshotted into this agent.
        You can edit the prompt below before creating.
      </p>

      {errors.length > 0 && (
        <div className="wiz-errors">
          {errors.map((e) => (
            <div key={e} className="wiz-error">{e}</div>
          ))}
        </div>
      )}

      {pickError && (
        <div className="wiz-error" style={{ marginBottom: 12 }}>{pickError}</div>
      )}

      {personasQuery.isLoading && (
        <div className="wiz-loading">Loading personas…</div>
      )}

      {personasQuery.isError && (
        <div className="wiz-error" style={{ marginBottom: 12 }}>
          Could not load personas. Check that the seeder has been run.
        </div>
      )}

      {!personasQuery.isLoading && (
        <>
          <div className="field" style={{ marginBottom: 14 }}>
            <input
              className="wiz-input"
              placeholder="Search personas…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="persona-cats" style={{ marginBottom: 18 }}>
            {/* Category rail */}
            <div className="persona-cat-list">
              <div
                className={`persona-cat${activeCat === 'all' ? ' on' : ''}`}
                onClick={() => setActiveCat('all')}
              >
                All
                <span className="ct">{personas.length}</span>
              </div>
              {categories.map((cat) => (
                <div
                  key={cat}
                  className={`persona-cat${activeCat === cat ? ' on' : ''}`}
                  onClick={() => setActiveCat(cat)}
                >
                  {cat}
                  <span className="ct">{catCounts[cat]}</span>
                </div>
              ))}
            </div>

            {/* Persona list */}
            <div className="persona-list">
              {filtered.length === 0 && (
                <div style={{ padding: '24px 12px', textAlign: 'center', fontFamily: 'var(--m-font-mono)', fontSize: 11, lineHeight: 1.7 }}>
                  {personas.length === 0 ? (
                    <>
                      <div style={{ opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.18em', marginBottom: 6 }}>No personas found</div>
                      <div style={{ opacity: 0.4, fontSize: 10 }}>
                        Run <code style={{ background: 'var(--m-bg-deep,#000802)', padding: '1px 5px', borderRadius: 3 }}>pnpm seed-personas</code> to populate{' '}
                        <code style={{ background: 'var(--m-bg-deep,#000802)', padding: '1px 5px', borderRadius: 3 }}>~/.hermes/personas/</code>
                      </div>
                    </>
                  ) : (
                    <div style={{ opacity: 0.4, textTransform: 'uppercase', letterSpacing: '0.18em' }}>No personas match</div>
                  )}
                </div>
              )}
              {filtered.map((p) => (
                <div key={p.id}>
                  <div
                    className={`persona-row${draft.persona_id === p.id ? ' on' : ''}`}
                    onClick={() => void pickPersona(p)}
                  >
                    <div className="pf-glyph" style={{ width: 36, height: 36, fontSize: 15 }}>{p.glyph}</div>
                    <div>
                      <div className="pname">{p.name}</div>
                      <div className="pdesc">{p.description}</div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                        {p.tags.map((t) => (
                          <span key={t} className="pf-tag">{t}</span>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                      {loadingId === p.id ? (
                        <span className="ptag">loading…</span>
                      ) : draft.persona_id === p.id ? (
                        <span className="ptag">✓ selected</span>
                      ) : (
                        <span className="ptag">use →</span>
                      )}
                      <button
                        type="button"
                        className="wiz-btn-ghost"
                        onClick={(e) => {
                          e.stopPropagation()
                          setPreviewId(previewId === p.id ? null : p.id)
                        }}
                      >
                        {previewId === p.id ? 'Hide' : 'Preview'}
                      </button>
                    </div>
                  </div>
                  {previewId === p.id && (
                    <div className="wiz-persona-preview">
                      {p.system_prompt_preview}
                      {p.has_more_prompt && <span style={{ opacity: 0.5 }}> …</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Editable system prompt snapshot */}
      <div className="field">
        <label>System Prompt <span className="opt">(editable snapshot)</span></label>
        <textarea
          className="wiz-textarea"
          value={draft.system_prompt}
          onChange={(e) => onChange({ system_prompt: e.target.value })}
          placeholder="Select a persona above, or write a custom system prompt…"
          rows={6}
        />
      </div>
    </div>
  )
}
