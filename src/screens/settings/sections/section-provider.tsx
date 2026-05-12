/**
 * section-provider.tsx — Provider & model defaults (P3).
 *
 * Provider / default-model rows use local state + direct API calls (setModelAssignment)
 * so they are not deferred to Save. All other rows go through the settings store/saver.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { useSettingsStore } from '@/stores/settings-store'
import { modelInfo, modelOptions, setModelAssignment } from '@/server/hermes-api'
import { toast } from '@/components/ui/toast'

export default function SectionProvider() {
  const { draft, set } = useSettingsStore()

  const { data: info } = useQuery({
    queryKey: ['model-info'],
    queryFn: modelInfo,
    staleTime: 30_000,
  })

  const { data: options } = useQuery({
    queryKey: ['model-options'],
    queryFn: modelOptions,
    staleTime: 30_000,
  })

  // Local committed state for provider/model (bypasses store, direct API)
  const [committedProvider, setCommittedProvider] = useState<string | null>(null)
  const [committedModel, setCommittedModel] = useState<string | null>(null)

  const currentProvider = committedProvider ?? info?.provider ?? ''
  const currentModel = committedModel ?? info?.model ?? ''

  const providerList = options?.providers ?? []
  const modelsForProvider =
    providerList.find((p) => p.id === currentProvider)?.models ?? []

  async function handleProviderChange(provider: string) {
    try {
      await setModelAssignment({ scope: 'main', provider, model: currentModel })
      setCommittedProvider(provider)
      toast('Provider updated', { type: 'success' })
    } catch {
      toast('Failed to update provider', { type: 'error' })
    }
  }

  async function handleModelChange(model: string) {
    try {
      await setModelAssignment({ scope: 'main', provider: currentProvider, model })
      setCommittedModel(model)
      toast('Default model updated', { type: 'success' })
    } catch {
      toast('Failed to update model', { type: 'error' })
    }
  }

  const temperature = (draft['config.temperature'] as number | undefined) ?? 1.0
  const topP = (draft['config.top_p'] as number | undefined) ?? 1.0
  const maxTokens = (draft['config.max_tokens'] as number | undefined) ?? 4096
  const fallbackModel = (draft['config.fallback_model'] as string | undefined) ?? ''
  const reasoning = (draft['config.reasoning'] as boolean | undefined) ?? false
  const promptCaching = (draft['config.prompt_caching'] as boolean | undefined) ?? true
  const streamOutputs = (draft['config.stream_outputs'] as boolean | undefined) ?? true

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Provider</h2>
          <div className="desc">Default provider, model, and generation parameters.</div>
        </div>
        <div className="meta">Section · <b>provider</b></div>
      </div>

      <SettingCard title="Provider & model">
        <SettingRow label="Provider" desc="Active backend provider">
          <select
            className="select-input"
            value={currentProvider}
            onChange={(e) => void handleProviderChange(e.target.value)}
          >
            {providerList.length === 0 && (
              <option value={currentProvider}>{currentProvider || 'Loading…'}</option>
            )}
            {providerList.map((p) => (
              <option key={p.id} value={p.id}>{p.id}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label="Default model" desc="Model used for new sessions">
          <select
            className="select-input"
            value={currentModel}
            onChange={(e) => void handleModelChange(e.target.value)}
          >
            {modelsForProvider.length === 0 && (
              <option value={currentModel}>{currentModel || 'Loading…'}</option>
            )}
            {modelsForProvider.map((m) => (
              <option key={m.id} value={m.id}>{m.id}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label="Fallback model" desc="Model used when primary is unavailable">
          <input
            type="text"
            className="text-input"
            value={fallbackModel}
            placeholder="e.g. claude-3-haiku-20240307"
            onChange={(e) => set('config.fallback_model', e.target.value)}
          />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Generation parameters">
        <SettingRow label="Temperature" desc={`${temperature.toFixed(2)}`}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={temperature}
            onChange={(e) => set('config.temperature', parseFloat(e.target.value))}
          />
        </SettingRow>
        <SettingRow label="Top-P" desc={`${topP.toFixed(2)}`}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={topP}
            onChange={(e) => set('config.top_p', parseFloat(e.target.value))}
          />
        </SettingRow>
        <SettingRow label="Max tokens">
          <input
            type="number"
            className="text-input"
            value={maxTokens}
            min={1}
            max={200000}
            onChange={(e) => set('config.max_tokens', parseInt(e.target.value, 10))}
          />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Capabilities">
        <SettingRow label="Extended thinking" desc="Enable extended reasoning mode">
          <label className="toggle">
            <input
              type="checkbox"
              checked={reasoning}
              onChange={(e) => set('config.reasoning', e.target.checked)}
            />
            <span className="slider" />
          </label>
        </SettingRow>
        <SettingRow label="Prompt caching" desc="Cache prompt prefixes to reduce latency">
          <label className="toggle">
            <input
              type="checkbox"
              checked={promptCaching}
              onChange={(e) => set('config.prompt_caching', e.target.checked)}
            />
            <span className="slider" />
          </label>
        </SettingRow>
        <SettingRow label="Stream outputs" desc="Stream tokens as they are generated">
          <label className="toggle">
            <input
              type="checkbox"
              checked={streamOutputs}
              onChange={(e) => set('config.stream_outputs', e.target.checked)}
            />
            <span className="slider" />
          </label>
        </SettingRow>
      </SettingCard>
    </div>
  )
}
