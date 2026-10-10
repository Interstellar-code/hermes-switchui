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
 * requires truthy `provider` + `model` on each entry; it also preserves every
 * other key per entry — `base_url`, `key_env`, `api_key`, … — so every row
 * here keeps those keys through edit/move/remove too).
 *
 * Incomplete rows (missing provider or model) are dropped by the agent, so
 * they are marked invalid inline and never written: the draft only ever holds
 * complete rows, while the user's in-progress rows live in a local `shadow`
 * list that renders on top of the draft.
 *
 * Legacy `fallback_model`:
 *   - string form: the agent drops it. When the chain is empty and untouched,
 *     it pre-fills one editable row (with an "ignored by the agent" note);
 *     `fallback_model` itself is never written or cleared.
 *   - dict/list form: the agent still merges it after the chain, so it is
 *     shown read-only with a note saying so.
 *
 * The saver PUTs arrays whole (`flatten-config.ts` keeps arrays at one dotted
 * key; `saver.ts` nests it as a real list of dicts), so the body carries
 * `config.fallback_providers: [{provider, model, …}, …]`.
 */

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { SelectField } from '../components/select-field'
import { getKeyMeta } from '../lib/key-meta'
import { useSettingsStore } from '@/stores/settings-store'
import { valuesEqual } from '@/stores/settings-equal'
import {
  modelInfo,
  modelOptions,
  setModelAssignment,
} from '@/lib/hermes-client'
import { toast } from '@/components/ui/toast'

const FALLBACK_PROVIDERS_KEY = 'config.fallback_providers'
const FALLBACK_MODEL_KEY = 'config.fallback_model'

/** Every key of a chain entry is preserved; `provider`/`model` are coerced to strings. */
type FallbackEntry = { provider: string; model: string } & Record<
  string,
  unknown
>

function toEntry(record: Record<string, unknown>): FallbackEntry {
  return {
    ...record,
    provider: typeof record.provider === 'string' ? record.provider : '',
    model: typeof record.model === 'string' ? record.model : '',
  }
}

function normalizeFallbackChain(value: unknown): Array<FallbackEntry> {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return []
  const rows: Array<FallbackEntry> = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
      continue
    rows.push(toEntry(entry as Record<string, unknown>))
  }
  return rows
}

/** The agent keeps only entries with truthy provider + model; writes match that. */
export function isCompleteFallbackRow(row: FallbackEntry): boolean {
  return row.provider.trim() !== '' && row.model.trim() !== ''
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

/** A dict or list `fallback_model` is still merged by the agent after the chain. */
function legacyFallbackEntries(value: unknown): Array<FallbackEntry> {
  if (value === undefined || value === null || typeof value === 'string')
    return []
  const candidates = Array.isArray(value) ? value : [value]
  const entries: Array<FallbackEntry> = []
  for (const entry of candidates) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
      continue
    entries.push(toEntry(entry as Record<string, unknown>))
  }
  return entries
}

export default function SectionProvider() {
  const draft = useSettingsStore((s) => s.draft)
  const set = useSettingsStore((s) => s.set)
  const chainDirty = useSettingsStore((s) =>
    s.dirty.has(FALLBACK_PROVIDERS_KEY),
  )
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

  // While the option lists are still loading the old raw `<select>` rendered a
  // single placeholder option. Passing that placeholder as the option list
  // keeps SelectField on its `known` branch, so it reproduces the old DOM and
  // the "Loading…" copy instead of relabelling the value "(not offered here)".
  const providerOptions =
    providerList.length === 0
      ? [{ value: currentProvider, label: currentProvider || 'Loading…' }]
      : providerList.map((p) => ({ value: p.slug, label: p.name ?? p.slug }))
  const modelFieldOptions =
    modelsForProvider.length === 0
      ? [{ value: currentModel, label: currentModel || 'Loading…' }]
      : modelsForProvider.map((m) => ({ value: m, label: m }))

  const caps = info?.capabilities as Record<string, unknown> | undefined
  const contextWindow = caps?.context_window as number | undefined
  const supportsTools = caps?.supports_tools as boolean | undefined
  const supportsVision = caps?.supports_vision as boolean | undefined
  const supportsReasoning = caps?.supports_reasoning as boolean | undefined

  const draftChain = normalizeFallbackChain(draft[FALLBACK_PROVIDERS_KEY])

  // Every row the user has touched (complete or not) since the chain key was
  // last clean. Incomplete rows exist ONLY here: visible and editable, but
  // never written to the draft — and the draft is what a save sends.
  const [shadowRows, setShadowRows] = useState<Array<FallbackEntry> | null>(
    null,
  )

  const fallbackModelRaw = draft[FALLBACK_MODEL_KEY]
  const legacyString =
    typeof fallbackModelRaw === 'string' && fallbackModelRaw.trim() !== ''
      ? fallbackModelRaw
      : null
  const legacyActive =
    legacyString === null ? legacyFallbackEntries(fallbackModelRaw) : []

  // Pre-fill when the chain is EMPTY — absent or `[]`; the defaults-merged
  // `GET /api/config` the screen seeds from always returns the key as `[]` —
  // and the user has not touched it. The shadow doubles as the "user removed
  // the pre-filled row" latch: once any edit lands, the pre-fill never
  // re-fires for this mount, so a removed row stays removed.
  const prefillActive =
    shadowRows === null &&
    legacyString !== null &&
    draftChain.length === 0 &&
    !chainDirty

  const rows: Array<FallbackEntry> =
    shadowRows ??
    (prefillActive ? [parseLegacyFallback(legacyString)] : draftChain)

  // A clean key means the draft is server truth again (discard, or a save
  // committed). If the shadow's complete rows disagree with the draft, the
  // user discarded — drop the shadow so the display reverts. When they agree,
  // the shadow only adds in-progress incomplete rows and is kept.
  useEffect(() => {
    if (shadowRows === null || chainDirty) return
    if (!valuesEqual(shadowRows.filter(isCompleteFallbackRow), draftChain)) {
      setShadowRows(null)
    }
  }, [shadowRows, chainDirty, draftChain])

  function commitRows(next: Array<FallbackEntry>) {
    setShadowRows(next)
    set(FALLBACK_PROVIDERS_KEY, next.filter(isCompleteFallbackRow))
  }

  function updateFallbackRow(
    index: number,
    patch: Partial<Pick<FallbackEntry, 'provider' | 'model'>>,
  ) {
    commitRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function moveFallbackRow(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= rows.length) return
    const next = [...rows]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    commitRows(next)
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
                    style={{
                      color: 'var(--m-text-muted, var(--theme-muted))',
                    }}
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
        <SettingRow
          label="Provider"
          desc="Active backend provider"
          // Bare id, not `config.model.provider`: this row writes through
          // setModelAssignment rather than the draft, and section-registry.test
          // reads every quoted `config.*` literal as a key this section owns.
          meta={getKeyMeta('model.provider')}
        >
          <SelectField
            options={providerOptions}
            value={currentProvider}
            onChange={(v) => void handleProviderChange(v)}
          />
        </SettingRow>
        <SettingRow label="Default model" desc="Model used for new sessions">
          <SelectField
            options={modelFieldOptions}
            value={currentModel}
            onChange={(v) => void handleModelChange(v)}
          />
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
          {prefillActive && (
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
              <span
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <span>
                  <code>fallback_model</code> is ignored by the agent — saved as{' '}
                  <code>fallback_providers</code>. The legacy key is left
                  untouched; only the chain below is written.
                </span>
                <span>
                  The row below is shown from the legacy{' '}
                  <code>fallback_model</code> — it is not saved until you edit
                  or confirm it.
                </span>
              </span>
            </div>
          )}

          {rows.length === 0 && !prefillActive && legacyActive.length === 0 && (
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

          {rows.map((row, i) => {
            const rowModels =
              providerList.find((p) => p.slug === row.provider)?.models ?? []
            const providerKnown = providerList.some(
              (p) => p.slug === row.provider,
            )
            const rowIncomplete = !isCompleteFallbackRow(row)
            return (
              <div
                key={i}
                data-fallback-row={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  flexWrap: 'wrap',
                  ...(rowIncomplete
                    ? {
                        borderRadius: '6px',
                        border:
                          '1px solid var(--m-danger, var(--theme-danger))',
                        padding: '6px 8px',
                      }
                    : {}),
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
                {/* Raw, not SelectField: the wrapper takes only id/aria-labelledby, and this
                    row needs its own `aria-label` plus an explicit unknown-value
                    option it already renders itself. */}
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
                {/* Raw, not TextField: it needs a `list`/`datalist` pairing and an inline
                    width, neither of which the wrapper accepts. */}
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
                  disabled={i === rows.length - 1}
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
                  onClick={() => commitRows(rows.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
                {rowIncomplete && (
                  <span
                    role="alert"
                    style={{
                      width: '100%',
                      fontSize: '11px',
                      fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
                      color: 'var(--m-danger, var(--theme-danger))',
                    }}
                  >
                    provider and model are both required — this row will not be
                    saved
                  </span>
                )}
              </div>
            )
          })}

          {legacyActive.length > 0 && (
            <div
              role="status"
              data-legacy-fallback
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid var(--m-border, var(--theme-border))',
                background:
                  'color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 6%, transparent)',
                fontSize: '12px',
                color: 'var(--m-text-faint, var(--theme-muted))',
                lineHeight: 1.4,
              }}
            >
              <span>
                A legacy <code>fallback_model</code> (dict/list form) is still
                read by the agent — its entries are tried after the chain above.
                Read-only here; edit it via the raw config.
              </span>
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}
              >
                {legacyActive.map((entry, i) => (
                  <span
                    key={i}
                    style={{
                      fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
                      fontSize: '11px',
                    }}
                  >
                    {`${entry.provider || '?'} / ${entry.model || '?'}`}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <button
              type="button"
              className="btn"
              style={{ fontSize: '11px', padding: '4px 10px' }}
              onClick={() => commitRows([...rows, { provider: '', model: '' }])}
            >
              + Add fallback
            </button>
          </div>
        </div>
      </SettingCard>
    </div>
  )
}
