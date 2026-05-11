import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { NewAgentDraft } from '../types'

type ModelEntry = {
  id: string
  name?: string
  provider?: string
}

type Props = {
  draft: NewAgentDraft
  errors: string[]
  onChange: (patch: Partial<NewAgentDraft>) => void
}

async function fetchModels(): Promise<ModelEntry[]> {
  const r = await fetch('/api/models')
  if (!r.ok) return []
  const data = (await r.json()) as { models?: ModelEntry[]; items?: ModelEntry[] }
  return data.models ?? data.items ?? []
}

const PROVIDERS = ['anthropic', 'openai', 'openrouter', 'manifest', 'ollama', 'groq']
const EFFORT_OPTIONS: Array<{ value: NewAgentDraft['reasoning_effort']; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

export function WizardStepModel({ draft, errors, onChange }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  const modelsQuery = useQuery({
    queryKey: ['models'],
    queryFn: fetchModels,
    staleTime: 120_000,
  })

  const models = modelsQuery.data ?? []

  // Derive unique providers from model list + static fallback
  const dynamicProviders = Array.from(new Set(models.map((m) => m.provider).filter(Boolean) as string[]))
  const allProviders = Array.from(new Set([...dynamicProviders, ...PROVIDERS]))

  return (
    <div>
      <h3>Model</h3>
      <p className="lead">Choose the model and provider this agent will use by default.</p>

      {errors.length > 0 && (
        <div className="wiz-errors">
          {errors.map((e) => (
            <div key={e} className="wiz-error">{e}</div>
          ))}
        </div>
      )}

      <div className="grid-2" style={{ marginBottom: 18 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Model</label>
          {models.length > 0 ? (
            <select
              className="wiz-select"
              value={draft.model}
              onChange={(e) => onChange({ model: e.target.value })}
            >
              <option value="">Select model…</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.name ?? m.id}</option>
              ))}
            </select>
          ) : (
            <input
              className="wiz-input"
              value={draft.model}
              onChange={(e) => onChange({ model: e.target.value })}
              placeholder="claude-sonnet-4-6"
            />
          )}
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label>Provider</label>
          <select
            className="wiz-select"
            value={draft.provider}
            onChange={(e) => onChange({ provider: e.target.value })}
          >
            <option value="">Select provider…</option>
            {allProviders.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Advanced disclosure */}
      <button
        type="button"
        className="wiz-btn-ghost"
        style={{ marginBottom: showAdvanced ? 14 : 0 }}
        onClick={() => setShowAdvanced((v) => !v)}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 12, height: 12, transition: 'transform 120ms', transform: showAdvanced ? 'rotate(90deg)' : 'none' }}>
          <polyline points="6,4 10,8 6,12"/>
        </svg>
        Advanced
      </button>

      {showAdvanced && (
        <div className="wiz-advanced-panel">
          <div className="field">
            <label>Max Turns <span className="opt">(default 200)</span></label>
            <input
              className="wiz-input"
              type="number"
              min={1}
              max={2000}
              value={draft.max_turns}
              onChange={(e) => onChange({ max_turns: Math.max(1, parseInt(e.target.value) || 200) })}
            />
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label>Reasoning Effort</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {EFFORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`wiz-effort-btn${draft.reasoning_effort === opt.value ? ' on' : ''}`}
                  onClick={() => onChange({ reasoning_effort: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
