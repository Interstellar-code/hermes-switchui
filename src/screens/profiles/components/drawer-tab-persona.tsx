import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AgentRow } from '../profiles-screen'

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
  agent: AgentRow
  personaId: string | null
  systemPrompt: string
  readonly: boolean
  onSave: (patch: { system_prompt: string; agent_ui: { persona_id: string | null } }) => Promise<void>
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

export function DrawerTabPersona({ agent, personaId, systemPrompt, readonly, onSave }: Props) {
  const [promptEdit, setPromptEdit] = useState(systemPrompt)
  const [promptEditing, setPromptEditing] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerCat, setPickerCat] = useState('all')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const personasQuery = useQuery({
    queryKey: ['personas', 'list'],
    queryFn: fetchPersonas,
    staleTime: 60_000,
    enabled: pickerOpen,
  })
  const personas = personasQuery.data ?? []

  const catCounts: Record<string, number> = {}
  for (const p of personas) catCounts[p.category] = (catCounts[p.category] ?? 0) + 1
  const categories = Object.keys(catCounts).sort()

  const filteredPersonas = personas.filter((p) => {
    if (pickerCat !== 'all' && p.category !== pickerCat) return false
    if (pickerSearch) {
      const q = pickerSearch.toLowerCase()
      return p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    }
    return true
  })

  async function handleResnapshot() {
    if (!personaId) return
    if (!window.confirm('Re-snapshot will overwrite the current system prompt with the latest persona text. Continue?')) return
    setBusy(true)
    try {
      const prompt = await fetchPersonaPrompt(personaId)
      await onSave({ system_prompt: prompt, agent_ui: { persona_id: personaId } })
      setPromptEdit(prompt)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleSwitchPersona(p: PersonaListItem) {
    if (!window.confirm(`Switch to "${p.name}"? This will overwrite the current system prompt.`)) return
    setBusy(true)
    try {
      const prompt = await fetchPersonaPrompt(p.id)
      await onSave({ system_prompt: prompt, agent_ui: { persona_id: p.id } })
      setPromptEdit(prompt)
      setPickerOpen(false)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleClearPersonaLink() {
    if (!window.confirm('Clear persona link? The current system prompt will be kept but the persona reference removed.')) return
    setBusy(true)
    try {
      await onSave({ system_prompt: promptEdit, agent_ui: { persona_id: null } })
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleSavePrompt() {
    setBusy(true)
    try {
      await onSave({ system_prompt: promptEdit, agent_ui: { persona_id: personaId } })
      setPromptEditing(false)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {/* Persona badge */}
      <div style={{ marginBottom: 16 }}>
        <p className="pf-drawer-section-title">Persona</p>
        {personaId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ padding: '3px 10px', background: 'var(--m-fill,rgba(0,255,65,.08))', border: '1px solid var(--m-border,var(--theme-border))', borderRadius: 4, fontFamily: 'monospace', fontSize: 11 }}>
              {personaId}
            </span>
            {!readonly && (
              <button type="button" className="pf-drawer-action-btn" style={{ fontSize: 9 }} onClick={() => void handleClearPersonaLink()} disabled={busy}>
                Clear link
              </button>
            )}
          </div>
        ) : (
          <span style={{ fontFamily: 'monospace', fontSize: 11, opacity: .5 }}>No persona linked</span>
        )}
      </div>

      {/* System prompt */}
      <div style={{ marginBottom: 16 }}>
        <p className="pf-drawer-section-title">System Prompt</p>
        <textarea
          className="pf-drawer-textarea"
          value={promptEdit}
          readOnly={!promptEditing || readonly}
          onChange={(e) => setPromptEdit(e.target.value)}
          style={{ minHeight: 180 }}
        />
      </div>

      {/* Actions */}
      {!readonly && (
        <div className="pf-drawer-actions">
          {!promptEditing ? (
            <button type="button" className="pf-drawer-action-btn" onClick={() => setPromptEditing(true)}>
              Edit Prompt
            </button>
          ) : (
            <>
              <button type="button" className="pf-drawer-btn-save" onClick={() => void handleSavePrompt()} disabled={busy}>
                {busy ? 'Saving…' : 'Save Prompt'}
              </button>
              <button type="button" className="pf-drawer-btn-cancel" onClick={() => { setPromptEditing(false); setPromptEdit(systemPrompt) }}>
                Cancel
              </button>
            </>
          )}
          {personaId && !promptEditing && (
            <button type="button" className="pf-drawer-action-btn" onClick={() => void handleResnapshot()} disabled={busy}>
              Re-snapshot from persona
            </button>
          )}
          <button type="button" className="pf-drawer-action-btn primary" onClick={() => setPickerOpen(true)}>
            Switch persona
          </button>
        </div>
      )}

      {/* Persona picker */}
      {pickerOpen && (
        <div style={{ marginTop: 20, border: '1px solid var(--m-border,var(--theme-border))', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--m-border,var(--theme-border))', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              className="pf-drawer-input"
              style={{ flex: 1 }}
              placeholder="Search personas…"
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
              autoFocus
            />
            <button type="button" className="pf-drawer-btn-cancel" onClick={() => setPickerOpen(false)}>Close</button>
          </div>
          <div style={{ display: 'flex', height: 300 }}>
            {/* Category rail */}
            <div style={{ width: 120, borderRight: '1px solid var(--m-border,var(--theme-border))', overflowY: 'auto', flexShrink: 0, padding: '8px 0' }}>
              {(['all', ...categories]).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setPickerCat(cat)}
                  style={{ display: 'block', width: '100%', padding: '7px 12px', textAlign: 'left', background: pickerCat === cat ? 'var(--m-fill,rgba(0,255,65,.08))' : 'transparent', border: 'none', borderRight: pickerCat === cat ? '2px solid var(--m-green-500,#00ff41)' : '2px solid transparent', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em', cursor: 'pointer', color: pickerCat === cat ? 'var(--m-green-500,#00ff41)' : 'var(--m-text-muted,var(--theme-muted))' }}
                >
                  {cat === 'all' ? `All (${personas.length})` : `${cat} (${catCounts[cat] ?? 0})`}
                </button>
              ))}
            </div>
            {/* Persona rows */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
              {personasQuery.isLoading && <div style={{ padding: 16, fontFamily: 'monospace', fontSize: 11, opacity: .5 }}>Loading personas…</div>}
              {personasQuery.isError && <div style={{ padding: 16, fontFamily: 'monospace', fontSize: 11, color: 'var(--m-red,#ff4444)' }}>Failed to load personas</div>}
              {!personasQuery.isLoading && filteredPersonas.length === 0 && (
                <div style={{ padding: 16, fontFamily: 'monospace', fontSize: 11, opacity: .5 }}>
                  {personas.length === 0 ? 'No personas found. Run `pnpm seed-personas` to populate.' : 'No matches'}
                </div>
              )}
              {filteredPersonas.map((p) => (
                <div
                  key={p.id}
                  style={{ padding: '10px 12px', borderRadius: 6, marginBottom: 4, cursor: 'pointer', border: `1px solid ${previewId === p.id ? 'var(--m-green-500,#00ff41)' : 'transparent'}`, background: previewId === p.id ? 'var(--m-fill,rgba(0,255,65,.06))' : 'transparent' }}
                  onClick={() => setPreviewId(previewId === p.id ? null : p.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 28, height: 28, background: 'var(--m-fill,rgba(0,255,65,.1))', border: '1px solid var(--m-green-500,#00ff41)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: 10, fontWeight: 700, color: 'var(--m-green-500,#00ff41)', flexShrink: 0 }}>
                        {p.glyph}
                      </span>
                      <div>
                        <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{p.name}</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 10, opacity: .6 }}>{p.description}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="pf-drawer-action-btn primary"
                      style={{ fontSize: 9 }}
                      onClick={(e) => { e.stopPropagation(); void handleSwitchPersona(p) }}
                      disabled={busy}
                    >
                      Select
                    </button>
                  </div>
                  {previewId === p.id && (
                    <div style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 10, opacity: .7, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto', padding: '6px 8px', background: 'var(--m-bg-deep,#000802)', borderRadius: 4 }}>
                      {p.system_prompt_preview}
                      {p.has_more_prompt && <span style={{ opacity: .4 }}> …</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
