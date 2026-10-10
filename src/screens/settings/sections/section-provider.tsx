/**
 * section-provider.tsx — Provider & model defaults.
 *
 * Summary card: active provider + model from modelInfo(), capabilities chips,
 * context-window kv, "Open Providers →" button.
 * Provider / default-model rows use local state + direct API calls (setModelAssignment).
 *
 * Fallback chain card edits `config.fallback_providers` — an ordered list of
 * `{provider, model}` rows — which is the only fallback shape the agent reads
 * (`hermes_cli/fallback_config.py:get_fallback_chain` keeps list order and
 * requires truthy `provider` + `model` on each entry). The legacy string
 * `config.fallback_model` is dropped by the agent, so it is never written:
 * when it holds a string and `fallback_providers` is absent, the chain is
 * pre-filled from it (with a note) and any edit persists `fallback_providers`
 * only. The saver PUTs arrays whole (`flatten-config.ts` keeps arrays at one
 * dotted key; `saver.ts` nests it as a real list of dicts), so the body
 * carries `config.fallback_providers: [{provider, model}, …]`.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { useSettingsStore } from '@/stores/settings-store'
import {
  modelInfo,
  modelOptions,
  setModelAssignment,
} from '@/lib/hermes-client'
import { toast } from '@/components/ui/toast'

const FALLBACK_PROVIDERS_KEY = 'config.fallback_providers'
const FALLBACK_MODEL_KEY = 'config.fallback_model'

type FallbackEntry = { provider: string; model: string }

/**
 * `null` means the key is absent from the draft (nothing saved yet) — distinct
 * from `[]`, which is an explicitly empty chain the user chose. Non-array
 * values and non-dict entries cannot round-trip through the agent and are
 * dropped rather than corrupted into visible rows.
 */
function normalizeFallbackChain(value: unknown): Array<FallbackEntry> | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) return []
  const rows: Array<FallbackEntry> = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
      continue
    const record = entry as Record<string, unknown>
    rows.push({
      provider: typeof record.provider === 'string' ? record.provider : '',
      model: typeof record.model === 'string' ? record.model : '',
    })
  }
  return rows
}

/** Parse a legacy `fallback_model` string: `"provider/model"`, else bare model. */
export function parseLegacyFallback(raw: string): FallbackEntry {
  const trimmed = raw.trim()
  const slash = trimmed.indexOf('/')
  if (slash === -1) return { provider: '', model: trimmed }
  return {
    provider: trimmed.slice(0, slash).trim(),
    model: trimmed.slice(slash + 1).trim(),
  }
}

export default function SectionProvider() {
  const draft = useSettingsStore((s) => s.draft)
  const set = useSettingsStore((s) => s.set)
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
  const [committedProvider, setCommittedProvider] = useState<string | null>(
    null,
  )
  const [committedModel, setCommittedModel] = useState<string | null>(null)

  const currentProvider = committedProvider ?? info?.provider ?? ''
  const currentModel = committedModel ?? info?.model ?? ''

  const providerList = options?.providers ?? []
  const modelsForProvider: Array<string> =
    providerList.find((p) => p.slug === currentProvider)?.models ?? []

  const caps = info?.capabilities as Record<string, unknown> | undefined
  const contextWindow = caps?.context_window as number | undefined
  const supportsTools = caps?.supports_tools as boolean | undefined
  const supportsVision = caps?.supports_vision as boolean | undefined
  const supportsReasoning = caps?.supports_reasoning as boolean | undefined

  // Legacy pre-fill: only while `fallback_providers` is absent from the draft
  // AND `fallback_model` holds a non-empty string. The first chain edit writes
  // `fallback_providers`, after which the legacy value stops mattering. An
  // explicit `[]` is a user-chosen empty chain and does not re-trigger the
  // pre-fill, or removing the pre-filled row could never stick.
  const fallbackModelRaw = draft[FALLBACK_MODEL_KEY]
  const legacyFallbackModel =
    typeof fallbackModelRaw === 'string' && fallbackModelRaw.trim() !== ''
      ? fallbackModelRaw
      : null
  const chainFromDraft = normalizeFallbackChain(draft[FALLBACK_PROVIDERS_KEY])
  const legacyPrefill = chainFromDraft === null && legacyFallbackModel !== null
  const fallbackRows: Array<FallbackEntry> = legacyPrefill
    ? [parseLegacyFallback(legacyFallbackModel)]
    : (chainFromDraft ?? [])

  function writeFallbackChain(next: Array<FallbackEntry>) {
    set(FALLBACK_PROVIDERS_KEY, next)
  }

  function updateFallbackRow(index: number, patch: Partial<FallbackEntry>) {
    writeFallbackChain(
      fallbackRows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    )
  }

  function moveFallbackRow(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= fallbackRows.length) return
    const next = [...fallbackRows]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    writeFallbackChain(next)
  }

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
      await setModelAssignment({
        scope: 'main',
        provider: currentProvider,
        model,
      })
      setCommittedModel(model)
      toast('Default model updated', { type: 'success' })
    } catch {
      toast('Failed to update model', { type: 'error' })
    }
  }

  const iconBtnStyle = {
    fontSize: '11px',
    padding: '4px 8px',
    flexShrink: 0,
  } as const

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Provider</h2>
          <div className="desc">Default provider, model, and capabilities.</div>
        </div>
        <div className="meta">
          Section · <b>provider</b>
        </div>
      </div>

      {/* Summary status card */}
      <SettingCard title="Status">
        <div
          style={{
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {infoLoading ? (
                <span
                  style={{
                    fontSize: '11px',
                    fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
                    color: 'var(--m-text-faint, var(--theme-muted))',
                  }}
                >
                  Loading…
                </span>
              ) : info ? (
                <span
                  style={{
                    fontSize: '11px',
                    fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
                    color: 'var(--m-green-500, var(--theme-accent))',
                  }}
                >
                  ✓ {info.provider} / {info.model}
                </span>
              ) : (
                <span
                  style={{
                    fontSize: '11px',
                    fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
                    color: 'var(--m-danger, var(--theme-danger))',
                  }}
                >
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
            <div
              className="kv"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                fontSize: '12px',
                fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
                color: 'var(--m-text-faint, var(--theme-muted))',
              }}
            >
              {contextWindow != null && (
                <div>
                  <span
                    style={{ color: 'var(--m-text-muted, var(--theme-muted))' }}
                  >
                    context window
                  </span>
                  {' · '}
                  {contextWindow.toLocaleString()} tokens
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  flexWrap: 'wrap',
                  marginTop: '4px',
                }}
              >
                {supportsTools && (
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      background: 'var(--m-card-2, var(--theme-card2))',
                      color: 'var(--m-text-muted, var(--theme-muted))',
                    }}
                  >
                    tools
                  </span>
                )}
                {supportsVision && (
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      background: 'var(--m-card-2, var(--theme-card2))',
                      color: 'var(--m-text-muted, var(--theme-muted))',
                    }}
                  >
                    vision
                  </span>
                )}
                {supportsReasoning && (
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      background: 'var(--m-card-2, var(--theme-card2))',
                      color: 'var(--m-text-muted, var(--theme-muted))',
                    }}
                  >
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
              <option value={currentProvider}>
                {currentProvider || 'Loading…'}
              </option>
            )}
            {providerList.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name ?? p.slug}
              </option>
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
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </SettingRow>
      </SettingCard>

      <SettingCard title="Fallback chain" sub="config.fallback_providers">
        <div
          style={{
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {legacyPrefill && (
            <div
              role="status"
              style={{
                display: 'flex',
                gap: '8px',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid var(--m-warning, var(--theme-warning))',
                background:
                  'color-mix(in srgb, var(--m-warning, var(--theme-warning)) 8%, transparent)',
                fontSize: '12px',
                color: 'var(--m-text, var(--theme-text))',
                lineHeight: 1.4,
              }}
            >
              <span aria-hidden style={{ flexShrink: 0 }}>
                ⚠
              </span>
              <span>
                <code>fallback_model</code> is ignored by the agent — saved as{' '}
                <code>fallback_providers</code>. The legacy key is left
                untouched; only the chain below is written.
              </span>
            </div>
          )}

          {fallbackRows.length === 0 && (
            <div
              style={{
                fontSize: '12px',
                fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
                color: 'var(--m-text-faint, var(--theme-muted))',
              }}
            >
              No fallback providers configured. When the primary provider is
              unavailable, requests fail instead of failing over.
            </div>
          )}

          {fallbackRows.map((row, i) => {
            const rowModels =
              providerList.find((p) => p.slug === row.provider)?.models ?? []
            const providerKnown = providerList.some(
              (p) => p.slug === row.provider,
            )
            return (
              <div
                key={i}
                data-fallback-row={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    width: '20px',
                    flexShrink: 0,
                    textAlign: 'right',
                    fontSize: '11px',
                    fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
                    color: 'var(--m-text-faint, var(--theme-muted))',
                  }}
                >
                  {i + 1}.
                </span>
                <select
                  className="select-input"
                  aria-label={`Fallback ${i + 1} provider`}
                  style={{ minWidth: '150px' }}
                  value={row.provider}
                  onChange={(e) =>
                    updateFallbackRow(i, { provider: e.target.value })
                  }
                >
                  <option value="">provider…</option>
                  {providerList.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name ?? p.slug}
                    </option>
                  ))}
                  {!providerKnown && row.provider !== '' && (
                    <option value={row.provider}>{row.provider}</option>
                  )}
                </select>
                <input
                  type="text"
                  className="text-input"
                  aria-label={`Fallback ${i + 1} model`}
                  list={`fallback-model-options-${i}`}
                  style={{ flex: 1, minWidth: '140px' }}
                  value={row.model}
                  placeholder="model"
                  onChange={(e) =>
                    updateFallbackRow(i, { model: e.target.value })
                  }
                />
                <datalist id={`fallback-model-options-${i}`}>
                  {rowModels.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <button
                  type="button"
                  className="btn"
                  aria-label={`Move fallback ${i + 1} up`}
                  title="Move up"
                  style={iconBtnStyle}
                  disabled={i === 0}
                  onClick={() => moveFallbackRow(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn"
                  aria-label={`Move fallback ${i + 1} down`}
                  title="Move down"
                  style={iconBtnStyle}
                  disabled={i === fallbackRows.length - 1}
                  onClick={() => moveFallbackRow(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn"
                  aria-label={`Remove fallback ${i + 1}`}
                  title="Remove"
                  style={iconBtnStyle}
                  onClick={() =>
                    writeFallbackChain(fallbackRows.filter((_, j) => j !== i))
                  }
                >
                  ✕
                </button>
              </div>
            )
          })}

          <div>
            <button
              type="button"
              className="btn"
              style={{ fontSize: '11px', padding: '4px 10px' }}
              onClick={() =>
                writeFallbackChain([
                  ...fallbackRows,
                  { provider: '', model: '' },
                ])
              }
            >
              + Add fallback
            </button>
          </div>
        </div>
      </SettingCard>
    </div>
  )
}
