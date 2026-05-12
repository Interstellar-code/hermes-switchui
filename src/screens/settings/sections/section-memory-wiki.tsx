/**
 * section-memory-wiki.tsx — Memory & Wiki settings (P4).
 *
 * Memory rows map to real hermes-agent config keys under `memory.*`.
 * Hindsight sub-card is shown only when provider === 'hindsight' and
 * writes env vars via putEnv / revealEnv from hermes-api.
 * Wiki card reads/writes via /api/knowledge/config (KnowledgeBaseConfig),
 * the same source-of-truth used by Memory → Wiki tab (settings-tab.tsx).
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { PasswordField, Toggle } from '../components/controls'
import type { KnowledgeBaseConfig } from '@/server/knowledge-config'
import type { EnvVarInfo } from '@/lib/hermes-client'
import { getEnv, putEnv, revealEnv } from '@/lib/hermes-client'
import { useSettingsStore } from '@/stores/settings-store'
import { toast } from '@/components/ui/toast'

// ── Hindsight env rows ────────────────────────────────────────────────────────

const HINDSIGHT_KEYS: Array<{
  key: string
  label: string
  desc: string
  type: 'password' | 'text' | 'number' | 'segmented'
  options?: Array<{ value: string; label: string }>
}> = [
  { key: 'HINDSIGHT_API_KEY', label: 'API Key', desc: 'Hindsight cloud API key', type: 'password' },
  { key: 'HINDSIGHT_BANK_ID', label: 'Bank ID', desc: 'Memory bank identifier', type: 'text' },
  {
    key: 'HINDSIGHT_BUDGET',
    label: 'Budget',
    desc: 'Context retrieval budget',
    type: 'segmented',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'mid', label: 'Mid' },
      { value: 'high', label: 'High' },
    ],
  },
  { key: 'HINDSIGHT_API_URL', label: 'API URL', desc: 'Override Hindsight endpoint', type: 'text' },
  {
    key: 'HINDSIGHT_MODE',
    label: 'Mode',
    desc: 'Cloud or local Hindsight instance',
    type: 'segmented',
    options: [
      { value: 'cloud', label: 'Cloud' },
      { value: 'local', label: 'Local' },
    ],
  },
  { key: 'HINDSIGHT_TIMEOUT', label: 'Timeout', desc: 'Request timeout in seconds', type: 'number' },
]

function HindsightEnvRow({
  envKey,
  label,
  desc,
  type,
  options,
  info,
}: {
  envKey: string
  label: string
  desc: string
  type: 'password' | 'text' | 'number' | 'segmented'
  options?: Array<{ value: string; label: string }>
  info: EnvVarInfo | undefined
}) {
  const qc = useQueryClient()
  const [revealedValue, setRevealedValue] = useState<string | null>(null)
  const [revealTimer, setRevealTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)

  const isSet = info?.is_set ?? false
  const redacted = info?.redacted_value ?? ''

  async function handleReveal() {
    if (revealedValue !== null) {
      setRevealedValue(null)
      if (revealTimer) clearTimeout(revealTimer)
      setRevealTimer(null)
      return
    }
    if (!isSet) {
      toast(`${envKey} is not configured`, { type: 'warning' })
      return
    }
    try {
      const result = await revealEnv(envKey)
      setRevealedValue(result.value)
      const t = setTimeout(() => {
        setRevealedValue(null)
        setRevealTimer(null)
      }, 30_000)
      setRevealTimer(t)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to reveal', { type: 'error' })
    }
  }

  async function handleSave(value: string) {
    if (!value.trim()) {
      toast('Value cannot be empty', { type: 'error' })
      return
    }
    setSaving(true)
    try {
      await putEnv(envKey, value.trim())
      await qc.invalidateQueries({ queryKey: ['env'] })
      setEditing(false)
      toast(`${label} updated`, { type: 'success' })
    } catch {
      toast(`Failed to update ${label}`, { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Segmented / number types: inline edit without modal
  if (type === 'segmented' && options) {
    const currentVal = revealedValue ?? redacted
    return (
      <SettingRow
        label={label}
        desc={desc}
        pill={isSet ? { t: 'set' } : { t: 'not set' }}
      >
        <div style={{ display: 'flex', gap: 4 }}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`btn btn-sm${currentVal === opt.value ? ' btn-primary' : ''}`}
              onClick={() => void handleSave(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </SettingRow>
    )
  }

  if (type === 'number') {
    return (
      <SettingRow
        label={label}
        desc={desc}
        pill={isSet ? { t: 'set' } : { t: 'not set' }}
      >
        {editing ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="number"
              className="text-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              style={{ width: 90 }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={saving}
              onClick={() => void handleSave(editValue)}
            >
              Save
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--m-font-mono)', fontSize: 12 }}>
              {isSet ? redacted : '—'}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setEditValue('')
                setEditing(true)
              }}
            >
              Edit
            </button>
          </div>
        )}
      </SettingRow>
    )
  }

  if (type === 'text') {
    return (
      <SettingRow
        label={label}
        desc={desc}
        pill={isSet ? { t: 'set' } : { t: 'not set' }}
      >
        {editing ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              className="text-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={saving}
              onClick={() => void handleSave(editValue)}
            >
              Save
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--m-font-mono)', fontSize: 12, color: 'var(--m-text-faint)' }}>
              {isSet ? redacted : '—'}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setEditValue('')
                setEditing(true)
              }}
            >
              Edit
            </button>
          </div>
        )}
      </SettingRow>
    )
  }

  // password type
  const displayValue = revealedValue ?? redacted
  return (
    <SettingRow
      label={label}
      desc={desc}
      pill={isSet ? { t: 'set' } : { t: 'not set' }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
        {editing ? (
          <>
            <PasswordField
              value={editValue}
              masked={false}
              onChange={setEditValue}
              placeholder="Enter new value"
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={saving}
              onClick={() => void handleSave(editValue)}
            >
              Save
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <PasswordField
              value={displayValue}
              masked={revealedValue === null}
              onChange={() => undefined}
              disabled
            />
            <button type="button" className="btn btn-sm" onClick={() => void handleReveal()} disabled={!isSet && revealedValue === null}>
              {revealedValue !== null ? 'Hide' : 'Reveal'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setEditValue('')
                setEditing(true)
              }}
            >
              Edit
            </button>
          </>
        )}
      </div>
    </SettingRow>
  )
}

// ── Wiki card (reads/writes /api/knowledge/config) ────────────────────────────

type ConfigResponse = { config: KnowledgeBaseConfig }

async function apiFetchConfig(url: string): Promise<ConfigResponse> {
  const res = await fetch(url)
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<ConfigResponse>
}

async function apiPostConfig(url: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok || payload.error) throw new Error(payload.error ?? `Request failed (${res.status})`)
}

function WikiCard() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sourceType, setSourceType] = useState<'local' | 'github'>('local')
  const [localPath, setLocalPath] = useState('')
  const [ghRepo, setGhRepo] = useState('')
  const [ghBranch, setGhBranch] = useState('main')
  const [ghPath, setGhPath] = useState('')

  const { data, isLoading, isError, refetch } = useQuery<ConfigResponse>({
    queryKey: ['knowledge', 'config'],
    queryFn: () => apiFetchConfig('/api/knowledge/config'),
    staleTime: 60_000,
  })

  function startEdit() {
    if (!data) return
    const src = data.config.source
    setSourceType(src.type)
    if (src.type === 'local') {
      setLocalPath(src.path)
    } else {
      setGhRepo(src.repo)
      setGhBranch(src.branch)
      setGhPath(src.path)
    }
    setEditing(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const source: KnowledgeBaseConfig['source'] =
        sourceType === 'local'
          ? { type: 'local', path: localPath.trim() }
          : { type: 'github', repo: ghRepo.trim(), branch: ghBranch.trim(), path: ghPath.trim() }
      await apiPostConfig('/api/knowledge/config', { source })
      await qc.invalidateQueries({ queryKey: ['knowledge', 'config'] })
      await qc.invalidateQueries({ queryKey: ['knowledge', 'list'] })
      toast('Wiki source saved', { type: 'success' })
      setEditing(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save config', { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingCard title="Wiki" sub="knowledge config">
      <SettingRow label="Wiki pages" desc="Browse, create, and edit wiki pages">
        <a href="/memory?tab=wiki" className="btn btn-sm" style={{ textDecoration: 'none' }}>
          Open Memory → Wiki
        </a>
      </SettingRow>

      {isLoading && (
        <div style={{ padding: '12px 18px', color: 'var(--m-text-faint)', fontSize: 12 }}>
          Loading…
        </div>
      )}
      {isError && (
        <SettingRow label="Error" desc="Failed to load wiki config">
          <button type="button" className="btn btn-sm" onClick={() => void refetch()}>
            Retry
          </button>
        </SettingRow>
      )}

      {data && !editing && (
        <>
          <SettingRow label="Source type" desc="Where Hermes reads and writes wiki pages">
            <span
              style={{
                fontFamily: 'var(--m-font-mono)',
                fontSize: 12,
                background: 'var(--m-surface-2)',
                borderRadius: 4,
                padding: '2px 8px',
              }}
            >
              {data.config.source.type}
            </span>
          </SettingRow>

          {data.config.source.type === 'local' && (
            <SettingRow label="Path" desc="Local filesystem directory for wiki pages">
              <span style={{ fontFamily: 'var(--m-font-mono)', fontSize: 12, color: 'var(--m-text-faint)' }}>
                {data.config.source.path || '(default $HERMES_HOME/wiki)'}
              </span>
            </SettingRow>
          )}

          {data.config.source.type === 'github' && (
            <>
              <SettingRow label="Repository" desc="GitHub owner/repo">
                <span style={{ fontFamily: 'var(--m-font-mono)', fontSize: 12, color: 'var(--m-text-faint)' }}>
                  {data.config.source.repo}
                </span>
              </SettingRow>
              <SettingRow label="Branch" desc="Git branch">
                <span style={{ fontFamily: 'var(--m-font-mono)', fontSize: 12, color: 'var(--m-text-faint)' }}>
                  {data.config.source.branch}
                </span>
              </SettingRow>
              <SettingRow label="Subdirectory" desc="Path within the repository">
                <span style={{ fontFamily: 'var(--m-font-mono)', fontSize: 12, color: 'var(--m-text-faint)' }}>
                  {data.config.source.path || '(root)'}
                </span>
              </SettingRow>
            </>
          )}

          <SettingRow label="" desc="">
            <button type="button" className="btn btn-sm" onClick={startEdit}>
              Edit Source
            </button>
          </SettingRow>
        </>
      )}

      {editing && (
        <>
          <SettingRow label="Source type" desc="Local filesystem or GitHub repository">
            <div style={{ display: 'flex', gap: 4 }}>
              {(['local', 'github'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`btn btn-sm${sourceType === t ? ' btn-primary' : ''}`}
                  onClick={() => setSourceType(t)}
                >
                  {t === 'local' ? 'Local' : 'GitHub'}
                </button>
              ))}
            </div>
          </SettingRow>

          {sourceType === 'local' && (
            <SettingRow label="Path" desc="Leave empty for $HERMES_HOME/wiki">
              <input
                type="text"
                className="text-input"
                value={localPath}
                placeholder="/Users/you/hermes/wikis/my-wiki"
                onChange={(e) => setLocalPath(e.target.value)}
              />
            </SettingRow>
          )}

          {sourceType === 'github' && (
            <>
              <SettingRow label="Repository" desc="owner/repo on GitHub">
                <input
                  type="text"
                  className="text-input"
                  value={ghRepo}
                  placeholder="acme/wiki"
                  onChange={(e) => setGhRepo(e.target.value)}
                />
              </SettingRow>
              <SettingRow label="Branch" desc="Git branch to read from">
                <input
                  type="text"
                  className="text-input"
                  value={ghBranch}
                  placeholder="main"
                  onChange={(e) => setGhBranch(e.target.value)}
                />
              </SettingRow>
              <SettingRow label="Subdirectory" desc="Optional path within repo">
                <input
                  type="text"
                  className="text-input"
                  value={ghPath}
                  placeholder="docs/"
                  onChange={(e) => setGhPath(e.target.value)}
                />
              </SettingRow>
            </>
          )}

          <SettingRow label="" desc="">
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </SettingRow>
        </>
      )}
    </SettingCard>
  )
}

// ── Main section ──────────────────────────────────────────────────────────────

const PROVIDER_OPTIONS = [
  { value: '', label: 'Disabled' },
  { value: 'hindsight', label: 'Hindsight' },
  { value: 'honcho', label: 'Honcho' },
  { value: 'mem0', label: 'mem0' },
  { value: 'builtin', label: 'Builtin' },
]

export default function SectionMemoryWiki() {
  const { draft, set } = useSettingsStore()

  const memoryEnabled =
    (draft['config.memory.memory_enabled'] as boolean | undefined) ?? true
  const userProfileEnabled =
    (draft['config.memory.user_profile_enabled'] as boolean | undefined) ?? false
  const provider =
    (draft['config.memory.provider'] as string | undefined) ?? ''
  const memoryCharLimit =
    (draft['config.memory.memory_char_limit'] as number | undefined) ?? 2200
  const userCharLimit =
    (draft['config.memory.user_char_limit'] as number | undefined) ?? 1375

  const { data: envVars, isLoading: envLoading } = useQuery({
    queryKey: ['env'],
    queryFn: getEnv,
    staleTime: 30_000,
  })

  const providerLabel =
    PROVIDER_OPTIONS.find((o) => o.value === provider)?.label ?? 'Disabled'
  const isConfigured = provider !== ''

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Memory &amp; Wiki</h2>
          <div className="desc">
            Memory retrieval settings and wiki integration.{' '}
            <span className={`pill${isConfigured ? '' : ' k-dirty'}`}>
              {isConfigured ? providerLabel : 'not configured'}
            </span>
          </div>
        </div>
        <div className="meta">Section · <b>memory-wiki</b></div>
      </div>

      <SettingCard title="Memory">
        <SettingRow label="Memory enabled" desc="Enable long-term memory retrieval for sessions">
          <Toggle on={memoryEnabled} set={(v) => set('config.memory.memory_enabled', v)} />
        </SettingRow>

        <SettingRow label="User profile enabled" desc="Build and use a persistent user profile for personalization">
          <Toggle on={userProfileEnabled} set={(v) => set('config.memory.user_profile_enabled', v)} />
        </SettingRow>

        <SettingRow label="Provider" desc="Memory backend provider">
          <select
            className="select-input"
            value={provider}
            onChange={(e) => set('config.memory.provider', e.target.value)}
          >
            {PROVIDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </SettingRow>

        <SettingRow
          label="Memory char limit"
          desc={`${memoryCharLimit} — max characters injected from memory per request`}
        >
          <input
            type="number"
            className="text-input"
            min={100}
            max={10000}
            step={100}
            value={memoryCharLimit}
            style={{ width: 90 }}
            onChange={(e) =>
              set('config.memory.memory_char_limit', parseInt(e.target.value, 10))
            }
          />
        </SettingRow>

        <SettingRow
          label="User char limit"
          desc={`${userCharLimit} — max characters from user profile per request`}
        >
          <input
            type="number"
            className="text-input"
            min={100}
            max={10000}
            step={100}
            value={userCharLimit}
            style={{ width: 90 }}
            onChange={(e) =>
              set('config.memory.user_char_limit', parseInt(e.target.value, 10))
            }
          />
        </SettingRow>
      </SettingCard>

      {provider === 'hindsight' && (
        <SettingCard
          title="Hindsight"
          sub="env vars"
        >
          {envLoading && (
            <div style={{ padding: '12px 18px', color: 'var(--m-text-faint)', fontSize: 12 }}>
              Loading…
            </div>
          )}
          {!envLoading &&
            HINDSIGHT_KEYS.map((cfg) => (
              <HindsightEnvRow
                key={cfg.key}
                envKey={cfg.key}
                label={cfg.label}
                desc={cfg.desc}
                type={cfg.type}
                options={cfg.options}
                info={envVars?.[cfg.key]}
              />
            ))}
        </SettingCard>
      )}

      <WikiCard />
    </div>
  )
}
