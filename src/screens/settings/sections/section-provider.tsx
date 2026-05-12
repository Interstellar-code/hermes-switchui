/**
 * section-provider.tsx — Provider & model defaults.
 *
 * Summary card: active provider + model from modelInfo(), capabilities chips,
 * context-window kv, "Open Providers →" button.
 * Provider / default-model rows use local state + direct API calls (setModelAssignment).
 * Generation-param rows dropped — keys don't exist in DEFAULT_CONFIG.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { useSettingsStore } from '@/stores/settings-store'
import { modelInfo, modelOptions, setModelAssignment } from '@/server/hermes-api'
import { toast } from '@/components/ui/toast'

export default function SectionProvider() {
  const { draft, set } = useSettingsStore()
  const navigate = useNavigate()

  const { data: info, isLoading: infoLoading } = useQuery({
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
  const modelsForProvider: string[] =
    providerList.find((p) => p.slug === currentProvider)?.models ?? []

  const caps = info?.capabilities as Record<string, unknown> | undefined
  const contextWindow = caps?.context_window as number | undefined
  const supportsTools = caps?.supports_tools as boolean | undefined
  const supportsVision = caps?.supports_vision as boolean | undefined
  const supportsReasoning = caps?.supports_reasoning as boolean | undefined

  const fallbackModel = (draft['config.fallback_model'] as string | undefined) ?? ''

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

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Provider</h2>
          <div className="desc">Default provider, model, and capabilities.</div>
        </div>
        <div className="meta">Section · <b>provider</b></div>
      </div>

      {/* Summary status card */}
      <SettingCard title="Status">
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {infoLoading ? (
                <span style={{ fontSize: '11px', fontFamily: 'var(--m-font-mono)', color: 'var(--m-text-faint)' }}>
                  Loading…
                </span>
              ) : info ? (
                <span style={{ fontSize: '11px', fontFamily: 'var(--m-font-mono)', color: 'var(--m-accent)' }}>
                  ✓ {info.provider} / {info.model}
                </span>
              ) : (
                <span style={{ fontSize: '11px', fontFamily: 'var(--m-font-mono)', color: 'var(--m-danger, #e05)' }}>
                  ⚠ Not detected
                </span>
              )}
            </div>
            <button
              className="btn"
              style={{ fontSize: '11px', padding: '4px 10px' }}
              onClick={() => void navigate({ to: '/settings/providers' })}
            >
              Open Providers →
            </button>
          </div>

          {info && (
            <div className="kv" style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontFamily: 'var(--m-font-mono)', color: 'var(--m-text-faint)' }}>
              {contextWindow != null && (
                <div>
                  <span style={{ color: 'var(--m-text-dim, var(--m-text-faint))' }}>context window</span>
                  {' · '}
                  {contextWindow.toLocaleString()} tokens
                </div>
              )}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                {supportsTools && (
                  <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'var(--m-surface-2)', color: 'var(--m-text-dim, var(--m-text-faint))' }}>
                    tools
                  </span>
                )}
                {supportsVision && (
                  <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'var(--m-surface-2)', color: 'var(--m-text-dim, var(--m-text-faint))' }}>
                    vision
                  </span>
                )}
                {supportsReasoning && (
                  <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'var(--m-surface-2)', color: 'var(--m-text-dim, var(--m-text-faint))' }}>
                    reasoning
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </SettingCard>

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
              <option key={p.slug} value={p.slug}>{p.name ?? p.slug}</option>
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
              <option key={m} value={m}>{m}</option>
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
    </div>
  )
}
