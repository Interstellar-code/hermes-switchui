'use client'

import '@/styles/matrix-settings-dialog.css'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  CloudIcon,
  ComputerIcon,
  MessageMultiple01Icon,
  Mic01Icon,
  Moon01Icon,
  Notification03Icon,
  PaintBoardIcon,
  Settings02Icon,
  SparklesIcon,
  Sun01Icon,
  VolumeHighIcon,
} from '@hugeicons/core-free-icons'
import { Component, useCallback, useEffect, useState } from 'react'
import type * as React from 'react'
import type { SettingsThemeMode } from '@/hooks/use-settings'
import type { LocaleId } from '@/lib/i18n'
import type { ThemeId } from '@/lib/theme'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { applyTheme, useSettings } from '@/hooks/use-settings'
import {
  THEMES,
  getTheme,
  getThemeVariant,
  isDarkTheme,
  setTheme,
} from '@/lib/theme'
import { cn } from '@/lib/utils'
import { getProviderEnvKey } from '@/lib/provider-catalog'
import { useChatSettingsStore } from '@/hooks/use-chat-settings'
import BackendUnavailableState from '@/components/backend-unavailable-state'
import { getUnavailableReason } from '@/lib/feature-gates'
import { LOCALE_LABELS, getLocale, setLocale } from '@/lib/i18n'
import { useFeatureAvailable } from '@/hooks/use-feature-available'
import { ProviderLogo } from '@/components/provider-logo'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'

// ── Types ───────────────────────────────────────────────────────────────

type SectionId =
  | 'claude'
  | 'agent'
  | 'routing'
  | 'voice'
  | 'display'
  | 'appearance'
  | 'chat'
  | 'notifications'
  | 'language'

const SECTIONS: Array<{ id: SectionId; label: string; icon: any }> = [
  { id: 'claude', label: 'Model & Provider', icon: CloudIcon },
  { id: 'agent', label: 'Agent', icon: Settings02Icon },
  { id: 'routing', label: 'Smart Routing', icon: SparklesIcon },
  { id: 'voice', label: 'Voice', icon: VolumeHighIcon },
  { id: 'display', label: 'Display', icon: PaintBoardIcon },
  { id: 'appearance', label: 'Theme', icon: PaintBoardIcon },
  { id: 'chat', label: 'Chat', icon: MessageMultiple01Icon },
  { id: 'notifications', label: 'Alerts', icon: Notification03Icon },
  { id: 'language', label: 'Language', icon: MessageMultiple01Icon },
]

const DARK_ENTERPRISE_THEMES = new Set<ThemeId>([
  'claude-nous',
  'claude-official',
  'claude-classic',
  'claude-slate',
])

function _isDarkEnterpriseTheme(theme: string | null): theme is ThemeId {
  if (!theme) return false
  return DARK_ENTERPRISE_THEMES.has(theme as ThemeId)
}
void _isDarkEnterpriseTheme

// ── Shared building blocks ──────────────────────────────────────────────

function SectionHeader({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="mb-2">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary-500">
        Settings
      </p>
      <h3 className="text-base font-semibold text-primary-900 dark:text-neutral-100">
        {title}
      </h3>
      <p className="text-xs text-primary-500 dark:text-neutral-400">
        {description}
      </p>
    </div>
  )
}

function Row({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-primary-900 dark:text-neutral-100">
          {label}
        </p>
        {description && (
          <p className="text-xs text-primary-500 dark:text-neutral-400">
            {description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

const SETTINGS_CARD_CLASS =
  'rounded-xl border border-primary-200 bg-primary-50/80 px-4 py-3 shadow-sm'

// ── Section components ──────────────────────────────────────────────────

/**
 * Display cards for the quick settings dialog. Logos and sample model names
 * are local presentation data; the credential env var comes from the shared
 * catalog so it cannot drift from what the server actually writes.
 */
const PROVIDER_CARDS: Array<{
  id: string
  name: string
  logo: string
  models: Array<string>
  authType: 'oauth' | 'api_key' | 'none'
  envKey?: string
}> = [
  // Local providers first — zero setup
  {
    id: 'ollama',
    name: 'Ollama',
    logo: '/providers/ollama.png',
    models: ['llama3.1:70b', 'qwen3:32b', 'deepseek-r1:32b'],
    authType: 'none',
  },
  {
    id: 'atomic-chat',
    name: 'Atomic Chat',
    logo: '/providers/atomic-chat.png',
    models: ['llama-3.2-3b', 'qwen2.5-7b', 'gemma-3-4b'],
    authType: 'none',
  },
  // Cloud providers
  {
    id: 'anthropic',
    name: 'Anthropic',
    logo: '/providers/anthropic.png',
    models: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-3-5'],
    authType: 'api_key',
    envKey: getProviderEnvKey('anthropic') ?? 'ANTHROPIC_API_KEY',
  },
  {
    id: 'nous',
    name: 'Nous Portal',
    logo: '/providers/nous.png',
    models: [
      'xiaomi/mimo-v2-pro',
      'xiaomi/mimo-v2-omni',
      'claude-3-llama-3.1-405b',
      'claude-3-llama-3.1-70b',
    ],
    authType: 'oauth',
  },
  {
    id: 'openai-codex',
    name: 'OpenAI Codex',
    logo: '/providers/openai.png',
    models: ['gpt-5.4', 'gpt-5.3-codex', 'gpt-4o'],
    authType: 'oauth',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    logo: '/providers/openrouter.png',
    models: ['auto', 'deepseek/deepseek-r1', 'google/gemini-2.5-pro'],
    authType: 'api_key',
    envKey: getProviderEnvKey('openrouter') ?? 'OPENROUTER_API_KEY',
  },
  {
    id: 'zai',
    name: 'Z.AI / GLM',
    logo: '/providers/zhipu.png',
    models: ['glm-4-plus', 'glm-4-air'],
    authType: 'api_key',
    envKey: getProviderEnvKey('zai') ?? 'GLM_API_KEY',
  },
  {
    id: 'kimi-coding',
    name: 'Kimi',
    logo: '/providers/kimi.png',
    models: ['kimi-latest', 'moonshot-v1-128k'],
    authType: 'api_key',
    envKey: getProviderEnvKey('kimi-coding') ?? 'KIMI_API_KEY',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    logo: '/providers/minimax.png',
    models: ['MiniMax-M2.7', 'MiniMax-M2.7-Lightning'],
    authType: 'api_key',
    envKey: getProviderEnvKey('minimax') ?? 'MINIMAX_API_KEY',
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi MiMo',
    logo: '/providers/xiaomi.png',
    models: ['mimo-v2-pro', 'mimo-v2-omni', 'mimo-v2-flash'],
    authType: 'api_key',
    envKey: getProviderEnvKey('xiaomi') ?? 'XIAOMI_API_KEY',
  },
  {
    id: 'custom',
    name: 'Custom',
    logo: '',
    models: [],
    authType: 'api_key',
    envKey: getProviderEnvKey('manifest') ?? 'CUSTOM_API_KEY',
  },
]

function HermesContent() {
  const configAvailable = useFeatureAvailable('config')
  const [activeProvider, setActiveProvider] = useState('')
  const [activeModel, setActiveModel] = useState('')
  const [availableModels, setAvailableModels] = useState<Array<string>>([])
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [_saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [configuredKeys, setConfiguredKeys] = useState<Record<string, string>>(
    {},
  )
  const [memEnabled, setMemEnabled] = useState(true)
  const [userProfileEnabled, setUserProfileEnabled] = useState(true)
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [localDiscovery, setLocalDiscovery] = useState<{
    providers: Array<{
      id: string
      name: string
      online: boolean
      modelCount: number
      configured: boolean
      needsRestart: boolean
    }>
    models: Array<{ id: string; name: string; provider: string }>
  } | null>(null)

  const fetchModelsForProvider = useCallback(
    (providerId: string) => {
      // For local providers, prefer auto-discovered models first
      if (localDiscovery) {
        const discovered = localDiscovery.models
          .filter((m) => m.provider === providerId)
          .map((m) => m.id)
        if (discovered.length > 0) {
          setAvailableModels(discovered)
          return
        }
      }
      fetch(
        `/api/claude-proxy/api/available-models?provider=${encodeURIComponent(providerId)}`,
      )
        .then((r) => r.json())
        .then((d: { models?: Array<{ id: string }> }) => {
          setAvailableModels((d.models || []).map((m) => m.id))
        })
        .catch(() => {
          // Fall back to hardcoded
          const card = PROVIDER_CARDS.find((p) => p.id === providerId)
          setAvailableModels(card?.models || [])
        })
    },
    [localDiscovery],
  )

  useEffect(() => {
    fetch('/api/local-providers')
      .then((r) => r.json())
      .then((d: any) => {
        if (d.ok) setLocalDiscovery(d)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/claude-config')
      .then((r) => r.json())
      .then((d: any) => {
        setActiveProvider(d.activeProvider || '')
        setActiveModel(d.activeModel || '')
        if (d.activeProvider) fetchModelsForProvider(d.activeProvider)
        const mem = (d.config?.memory || {}) as Record<string, unknown>
        setMemEnabled(mem.memory_enabled !== false)
        setUserProfileEnabled(mem.user_profile_enabled !== false)
        // Build configured keys map
        const keys: Record<string, string> = {}
        for (const p of d.providers || []) {
          if (p.configured && p.envKeys?.[0])
            keys[p.envKeys[0]] = p.maskedKeys?.[p.envKeys[0]] || '••••'
        }
        setConfiguredKeys(keys)
        // Load custom provider config (may be stored as 'custom' or legacy 'manifest')
        const cfgProviders = (d.config?.providers || {}) as Record<string, any>
        const customCfg =
          cfgProviders['custom'] || cfgProviders['manifest'] || {}
        if (customCfg.base_url) setCustomBaseUrl(customCfg.base_url)
      })
      .catch(() => {})
  }, [])

  const save = async (updates: {
    config?: Record<string, unknown>
    env?: Record<string, string>
  }) => {
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/claude-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      const r = (await res.json()) as { message?: string }
      setMsg(r.message || 'Saved')
      const ref = await fetch('/api/claude-config')
      const d = await ref.json()
      setActiveProvider(d.activeProvider || '')
      setActiveModel(d.activeModel || '')
      const keys: Record<string, string> = {}
      for (const p of d.providers || []) {
        if (p.configured && p.envKeys?.[0])
          keys[p.envKeys[0]] = p.maskedKeys?.[p.envKeys[0]] || '••••'
      }
      setConfiguredKeys(keys)
      setTimeout(() => setMsg(null), 3000)
    } catch {
      setMsg('Failed to save')
    }
    setSaving(false)
  }

  const selectProvider = (providerId: string, model?: string) => {
    setActiveProvider(providerId)
    if (model) {
      setActiveModel(model)
      save({ config: { model, provider: providerId } })
    } else {
      // Switching provider without a model — fetch models and pick the first one
      fetchModelsForProvider(providerId)
      save({ config: { provider: providerId } })
    }
  }

  if (!configAvailable) {
    return (
      <BackendUnavailableState
        feature="Hermes Agent Settings"
        description={getUnavailableReason('config')}
      />
    )
  }

  const cardStyle: React.CSSProperties = {
    backgroundColor: 'var(--theme-card)',
    border: '1px solid var(--theme-border)',
    color: 'var(--theme-text)',
  }
  const mutedStyle: React.CSSProperties = { color: 'var(--theme-muted)' }

  return (
    <div className="space-y-5">
      {msg && (
        <div
          className={cn(
            'rounded-lg px-3 py-2 text-sm font-medium',
            msg.includes('Failed')
              ? 'bg-red-500/15 text-red-400'
              : 'bg-green-500/15 text-green-400',
          )}
        >
          {msg}
        </div>
      )}

      {/* Provider Selection */}
      <div>
        <p
          className="mb-1 text-xs font-semibold uppercase tracking-wider"
          style={mutedStyle}
        >
          Provider
        </p>
        <p className="mb-3 text-[11px]" style={mutedStyle}>
          Select your AI provider. OAuth providers authenticate via browser.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PROVIDER_CARDS.map((p) => {
            const isActive = activeProvider === p.id
            const localOnline =
              localDiscovery?.providers.find((lp) => lp.id === p.id)?.online ===
              true
            // verified = truly available right now. OAuth status isn't tracked
            // here, so OAuth providers stay neutral until an actual session
            // check is wired. Local providers require live discovery hit.
            const verified =
              (p.authType === 'none' && localOnline) ||
              (p.authType === 'api_key' &&
                !!p.envKey &&
                !!configuredKeys[p.envKey])
            const missingKey =
              p.authType === 'api_key' && !verified && p.id !== 'custom'
            // hasKey gates click — keep OAuth + local clickable (existing
            // behaviour) so users can still authenticate via the card.
            const hasKey =
              p.authType === 'none' ||
              p.authType === 'oauth' ||
              verified ||
              p.id === 'custom'
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  if (hasKey) selectProvider(p.id)
                }}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-xl px-3 py-2.5 text-left transition-all',
                  isActive
                    ? 'ring-2 ring-accent-500 shadow-md'
                    : 'hover:brightness-110',
                  missingKey && 'opacity-60',
                )}
                style={cardStyle}
              >
                <div className="flex w-full items-center justify-between">
                  <ProviderLogo provider={p.id} size={32} />
                  {/* Single-dot precedence: active > missing-key > verified > none */}
                  {isActive ? (
                    <span className="size-2 rounded-full bg-green-500" />
                  ) : missingKey ? (
                    <span className="size-2 rounded-full bg-red-500/60" />
                  ) : verified ? (
                    <span className="size-2 rounded-full bg-green-500/40" />
                  ) : null}
                </div>
                <span className="text-xs font-semibold mt-1">{p.name}</span>
                <span className="text-[9px]" style={mutedStyle}>
                  {(() => {
                    const disc = localDiscovery?.providers.find(
                      (lp) => lp.id === p.id,
                    )
                    if (disc?.online) return '🟢 Detected'
                    if (p.authType === 'oauth') return 'OAuth'
                    if (p.authType === 'none') return 'Local'
                    return hasKey ? 'Key set' : 'Key required'
                  })()}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Model Selection for active provider */}
      {activeProvider && (
        <div>
          <p
            className="mb-1 text-xs font-semibold uppercase tracking-wider"
            style={mutedStyle}
          >
            Model
          </p>
          <div className="flex flex-wrap gap-2">
            {(() => {
              if (availableModels.length > 0) return availableModels
              // Use auto-discovered models for local providers
              const discovered = localDiscovery?.models
                .filter((m) => m.provider === activeProvider)
                .map((m) => m.id)
              if (discovered && discovered.length > 0) return discovered
              return (
                PROVIDER_CARDS.find((p) => p.id === activeProvider)?.models ||
                []
              )
            })().map((model) => (
              <button
                key={model}
                type="button"
                onClick={() => selectProvider(activeProvider, model)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                  activeModel === model
                    ? 'ring-2 ring-accent-500'
                    : 'hover:brightness-110',
                )}
                style={cardStyle}
              >
                {model}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Custom OpenAI-compatible endpoint fields — Base URL only; API key lives in API Keys section */}
      {activeProvider === 'custom' && (
        <div>
          <p
            className="mb-1 text-xs font-semibold uppercase tracking-wider"
            style={mutedStyle}
          >
            Custom Endpoint
          </p>
          <div className="space-y-1.5">
            {(() => {
              const isEditing = editingKey === 'custom_base_url'
              const hasValue = !!customBaseUrl
              return (
                <div
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                  style={cardStyle}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">Base URL</div>
                    <div className="text-[11px] font-mono" style={mutedStyle}>
                      {isEditing ? (
                        <input
                          type="url"
                          value={customBaseUrl}
                          onChange={(e) => setCustomBaseUrl(e.target.value)}
                          placeholder="http://127.0.0.1:38238/v1"
                          className="w-full rounded border-0 bg-transparent py-0.5 text-[11px] outline-none"
                          style={{ color: 'var(--theme-text)' }}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              save({
                                config: {
                                  model: { provider: 'manifest' },
                                  providers: {
                                    manifest: {
                                      type: 'openai',
                                      base_url: customBaseUrl,
                                      key_env: 'CUSTOM_API_KEY',
                                    },
                                  },
                                },
                              }).then(() => setEditingKey(null))
                            }
                            if (e.key === 'Escape') setEditingKey(null)
                          }}
                        />
                      ) : hasValue ? (
                        customBaseUrl
                      ) : (
                        'Not configured'
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'size-2 rounded-full',
                        hasValue ? 'bg-green-500' : 'bg-neutral-500',
                      )}
                    />
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            save({
                              config: {
                                model: { provider: 'manifest' },
                                providers: {
                                  manifest: {
                                    type: 'openai',
                                    base_url: customBaseUrl,
                                    key_env: 'CUSTOM_API_KEY',
                                  },
                                },
                              },
                            }).then(() => setEditingKey(null))
                          }}
                          className="text-xs font-medium text-green-400"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingKey(null)}
                          className="text-xs"
                          style={mutedStyle}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingKey('custom_base_url')}
                        className="text-xs font-medium"
                        style={{ color: 'var(--theme-accent)' }}
                      >
                        {hasValue ? 'Edit' : 'Add'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {(() => {
        const disc = localDiscovery?.providers.find(
          (lp) => lp.id === activeProvider,
        )
        if (!disc || !disc.needsRestart) return null
        return (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
            ⚠️ Gateway restart needed to use {disc.name}. Run{' '}
            <code className="rounded bg-black/30 px-1">
              hermes gateway restart
            </code>{' '}
            in your terminal.
          </div>
        )
      })()}

      {/* API Keys */}
      <div>
        <p
          className="mb-1 text-xs font-semibold uppercase tracking-wider"
          style={mutedStyle}
        >
          API Keys
        </p>
        <div className="space-y-1.5">
          {PROVIDER_CARDS.filter((p) => p.envKey).map((p) => {
            const key = p.envKey!
            const hasKey = !!configuredKeys[key]
            const isEditing = editingKey === key
            return (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                style={cardStyle}
              >
                <ProviderLogo
                  provider={p.id}
                  size={28}
                  className="rounded-md"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-[11px] font-mono" style={mutedStyle}>
                    {isEditing ? (
                      <input
                        type="password"
                        value={keyInput}
                        onChange={(e) => setKeyInput(e.target.value)}
                        placeholder={`Paste ${key}`}
                        className="w-full rounded border-0 bg-transparent py-0.5 text-[11px] outline-none"
                        style={{ color: 'var(--theme-text)' }}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && keyInput) {
                            save({ env: { [key]: keyInput } })
                            setEditingKey(null)
                            setKeyInput('')
                          }
                          if (e.key === 'Escape') {
                            setEditingKey(null)
                            setKeyInput('')
                          }
                        }}
                      />
                    ) : hasKey ? (
                      configuredKeys[key]
                    ) : (
                      'Not configured'
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'size-2 rounded-full',
                      hasKey ? 'bg-green-500' : 'bg-neutral-500',
                    )}
                  />
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          if (keyInput) {
                            save({ env: { [key]: keyInput } })
                          }
                          setEditingKey(null)
                          setKeyInput('')
                        }}
                        className="rounded-lg px-2 py-1 text-[11px] font-medium bg-accent-500 text-white"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingKey(null)
                          setKeyInput('')
                        }}
                        className="rounded-lg px-2 py-1 text-[11px] font-medium"
                        style={{ color: 'var(--theme-muted)' }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingKey(key)
                        setKeyInput('')
                      }}
                      className="rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-accent-500/10"
                      style={{
                        color: 'var(--theme-accent, var(--theme-text))',
                      }}
                    >
                      {hasKey ? 'Update' : 'Add'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Memory */}
      <div>
        <p
          className="mb-1 text-xs font-semibold uppercase tracking-wider"
          style={mutedStyle}
        >
          Memory
        </p>
        <div className="space-y-1.5">
          <div
            className="flex items-center justify-between rounded-xl px-3 py-2.5"
            style={cardStyle}
          >
            <div>
              <div className="text-sm font-medium">Memory</div>
              <div className="text-[11px]" style={mutedStyle}>
                Store & recall memories across sessions
              </div>
            </div>
            <Switch
              checked={memEnabled}
              onCheckedChange={(c) => {
                setMemEnabled(c)
                save({ config: { memory: { memory_enabled: c } } })
              }}
            />
          </div>
          <div
            className="flex items-center justify-between rounded-xl px-3 py-2.5"
            style={cardStyle}
          >
            <div>
              <div className="text-sm font-medium">User Profile</div>
              <div className="text-[11px]" style={mutedStyle}>
                Remember preferences & context
              </div>
            </div>
            <Switch
              checked={userProfileEnabled}
              onCheckedChange={(c) => {
                setUserProfileEnabled(c)
                save({ config: { memory: { user_profile_enabled: c } } })
              }}
            />
          </div>
        </div>
      </div>

      {/* Runtime Info */}
      <div className="rounded-xl px-3 py-2.5" style={cardStyle}>
        <div className="flex items-center gap-2 mb-2">
          <span className="size-2 rounded-full bg-green-500 animate-pulse" />
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={mutedStyle}
          >
            Runtime
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          <span style={mutedStyle}>Model</span>
          <span className="font-mono font-medium">{activeModel || '—'}</span>
          <span style={mutedStyle}>Provider</span>
          <span className="font-mono font-medium">
            {PROVIDER_CARDS.find((p) => p.id === activeProvider)?.name ||
              activeProvider ||
              '—'}
          </span>
          <span style={mutedStyle}>Config</span>
          <span className="font-mono font-medium">~/.hermes/config.yaml</span>
        </div>
      </div>
    </div>
  )
}

function AppearanceContent() {
  const { settings, updateSettings } = useSettings()

  function handleThemeChange(value: string) {
    const theme = value as SettingsThemeMode
    applyTheme(theme)
    if (theme === 'light' || theme === 'dark') {
      setTheme(getThemeVariant(getTheme(), theme))
    }
    updateSettings({ theme })
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Appearance"
        description="Theme and color accents."
      />
      <div className={SETTINGS_CARD_CLASS}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary-500">
          Theme Mode
        </p>
        <div className="inline-flex rounded-lg border border-primary-200 p-1">
          {[
            { value: 'light', label: 'Light', icon: Sun01Icon },
            { value: 'dark', label: 'Dark', icon: Moon01Icon },
            { value: 'system', label: 'System', icon: ComputerIcon },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleThemeChange(option.value)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                settings.theme === option.value
                  ? 'bg-accent-500 text-white'
                  : 'text-primary-600 hover:bg-primary-100',
              )}
            >
              <HugeiconsIcon icon={option.icon} size={16} strokeWidth={1.5} />
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {/* Accent color removed — themes control accent */}
      <div className={SETTINGS_CARD_CLASS}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary-500">
          Matrix Theme
        </p>
        <EnterpriseThemePicker />
      </div>
      <div className={SETTINGS_CARD_CLASS}>
        {/* Mobile chat nav removed — not relevant for Hermes */}
      </div>
    </div>
  )
}

const ENTERPRISE_THEME_FAMILIES: Array<ThemeId> = [
  'claude-nous',
  'matrix',
  'claude-official',
  'claude-classic',
  'claude-slate',
]

const ENTERPRISE_THEMES = THEMES.map((theme) => ({
  ...theme,
  desc: theme.description,
  preview:
    theme.id === 'claude-nous'
      ? {
          bg: '#041C1C',
          panel: '#06282A',
          border: 'rgba(255,230,203,0.2)',
          accent: '#FFAC02',
          text: '#FFE6CB',
        }
      : theme.id === 'claude-nous-light'
        ? {
            bg: '#F8FAF8',
            panel: '#FBFDFB',
            border: 'rgba(30,74,92,0.18)',
            accent: '#2557B7',
            text: '#16315F',
          }
        : theme.id === 'matrix'
          ? {
              bg: '#020804',
              panel: '#07130A',
              border: 'rgba(0,255,65,0.28)',
              accent: '#00FF41',
              text: '#D8FFE3',
            }
          : theme.id === 'matrix-light'
            ? {
                bg: '#F4FFF6',
                panel: '#FFFFFF',
                border: 'rgba(0,126,34,0.2)',
                accent: '#008F2D',
                text: '#062A12',
              }
            : theme.id === 'claude-official'
              ? {
                  bg: '#0A0E1A',
                  panel: '#11182A',
                  border: '#24304A',
                  accent: '#6366F1',
                  text: '#E6EAF2',
                }
              : theme.id === 'claude-official-light'
                ? {
                    bg: '#F7F7F1',
                    panel: '#FAFBF6',
                    border: '#CDD5DA',
                    accent: '#2557B7',
                    text: '#16315F',
                  }
                : theme.id === 'claude-classic'
                  ? {
                      bg: '#0d0f12',
                      panel: '#1a1f26',
                      border: '#2a313b',
                      accent: '#b98a44',
                      text: '#eceff4',
                    }
                  : theme.id === 'claude-classic-light'
                    ? {
                        bg: '#F5F2ED',
                        panel: '#FCFAF7',
                        border: '#D8CCBC',
                        accent: '#b98a44',
                        text: '#1a1f26',
                      }
                    : theme.id === 'claude-slate'
                      ? {
                          bg: '#0d1117',
                          panel: '#1c2128',
                          border: '#30363d',
                          accent: '#7eb8f6',
                          text: '#c9d1d9',
                        }
                      : {
                          bg: '#F6F8FA',
                          panel: '#FFFFFF',
                          border: '#D0D7DE',
                          accent: '#3b82f6',
                          text: '#24292f',
                        },
}))

function ThemeSwatch({
  colors,
}: {
  colors: (typeof ENTERPRISE_THEMES)[number]['preview']
}) {
  return (
    <div
      className="flex h-10 w-full overflow-hidden rounded-md border"
      style={{ borderColor: colors.border, backgroundColor: colors.bg }}
    >
      <div
        className="flex h-full w-4 flex-col gap-0.5 p-0.5"
        style={{ backgroundColor: colors.panel }}
      >
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-1.5 w-full rounded-sm"
            style={{ backgroundColor: colors.border }}
          />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-1">
        <div
          className="h-1.5 w-3/4 rounded"
          style={{ backgroundColor: colors.text, opacity: 0.8 }}
        />
        <div
          className="h-1 w-1/2 rounded"
          style={{ backgroundColor: colors.text, opacity: 0.3 }}
        />
        <div
          className="mt-0.5 h-1.5 w-6 rounded-full"
          style={{ backgroundColor: colors.accent }}
        />
      </div>
    </div>
  )
}

function EnterpriseThemePicker() {
  const { updateSettings } = useSettings()
  const [current, setCurrent] = useState(() => {
    if (typeof window === 'undefined') return 'claude-nous'
    return getTheme()
  })
  const currentMode = isDarkTheme(current) ? 'dark' : 'light'

  useEffect(() => {
    setCurrent(getTheme())
  }, [])

  function applyEnterpriseTheme(id: ThemeId) {
    setTheme(id)
    updateSettings({ theme: isDarkTheme(id) ? 'dark' : 'light' })
    setCurrent(id)
  }

  function toggleEnterpriseThemeMode() {
    const nextMode = currentMode === 'dark' ? 'light' : 'dark'
    applyEnterpriseTheme(getThemeVariant(current, nextMode))
  }

  const visibleThemes = ENTERPRISE_THEME_FAMILIES.map((themeId) =>
    ENTERPRISE_THEMES.find(
      (theme) => theme.id === getThemeVariant(themeId, currentMode),
    ),
  ).filter(Boolean) as typeof ENTERPRISE_THEMES

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-primary-200 px-3 py-2">
        <div>
          <p className="text-xs font-semibold text-primary-900 dark:text-neutral-100">
            {currentMode === 'dark' ? 'Dark mode' : 'Light mode'}
          </p>
          <p className="text-[11px] text-primary-500 dark:text-neutral-400">
            Toggle the current theme family between paired light and dark
            variants.
          </p>
        </div>
        <button
          type="button"
          onClick={toggleEnterpriseThemeMode}
          className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-900 transition-colors hover:bg-primary-100"
          aria-label={
            currentMode === 'dark'
              ? 'Switch matrix theme to light mode'
              : 'Switch matrix theme to dark mode'
          }
        >
          <HugeiconsIcon
            icon={currentMode === 'dark' ? Sun01Icon : Moon01Icon}
            size={16}
            strokeWidth={1.5}
          />
          {currentMode === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>
      <div className="grid w-full grid-cols-2 gap-2">
        {visibleThemes.map((t) => {
          const isActive = current === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => applyEnterpriseTheme(t.id)}
              className={cn(
                'flex flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors',
                isActive
                  ? 'border-accent-500 bg-accent-50 text-accent-700'
                  : 'border-primary-200 bg-primary-50/80 hover:bg-primary-100',
              )}
            >
              <ThemeSwatch colors={t.preview} />
              <div className="flex items-center gap-1">
                <span className="text-xs">{t.icon}</span>
                <span className="text-xs font-semibold text-primary-900 dark:text-neutral-100">
                  {t.label}
                </span>
                {isActive && (
                  <span className="ml-auto text-[9px] font-bold text-accent-600 uppercase tracking-wide">
                    Active
                  </span>
                )}
              </div>
              <p className="text-[10px] text-primary-500 dark:text-neutral-400 leading-tight">
                {t.desc}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ChatContent() {
  const { settings: cs, updateSettings: updateCS } = useChatSettingsStore()
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Chat"
        description="Message visibility and response loader style."
      />
      <div className={SETTINGS_CARD_CLASS}>
        <Row
          label="Show tool messages"
          description="Display tool call details in assistant responses."
        >
          <Switch
            checked={cs.showToolMessages}
            onCheckedChange={(c) => updateCS({ showToolMessages: c })}
            aria-label="Show tool messages"
          />
        </Row>
        <Row
          label="Show reasoning blocks"
          description="Display model reasoning blocks when available."
        >
          <Switch
            checked={cs.showReasoningBlocks}
            onCheckedChange={(c) => updateCS({ showReasoningBlocks: c })}
            aria-label="Show reasoning blocks"
          />
        </Row>
        <Row
          label="Sound on response complete"
          description="Play a short sound in the browser when the agent finishes replying."
        >
          <Switch
            checked={cs.soundOnChatComplete}
            onCheckedChange={(c) => updateCS({ soundOnChatComplete: c })}
            aria-label="Sound on response complete"
          />
        </Row>
        <Row
          label="Enter key behavior"
          description={
            cs.enterBehavior === 'newline'
              ? 'Enter inserts a newline. Use ⌘/Ctrl+Enter to send.'
              : 'Enter sends the message. Use Shift+Enter for a newline.'
          }
        >
          <Switch
            checked={cs.enterBehavior === 'newline'}
            onCheckedChange={(c) =>
              updateCS({ enterBehavior: c ? 'newline' : 'send' })
            }
            aria-label="Enter inserts newline instead of sending"
          />
        </Row>
        <Row
          label="Chat content width"
          description="Max-width of the message column on wide screens."
        >
          <select
            value={cs.chatWidth}
            onChange={(e) =>
              updateCS({
                chatWidth: e.target.value as 'comfortable' | 'wide' | 'full',
              })
            }
            className="h-8 rounded-md border border-primary-200 bg-primary-50 px-2 text-sm text-primary-900 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-400"
            aria-label="Chat content width"
          >
            <option value="comfortable">Comfortable (900px)</option>
            <option value="wide">Wide (1200px)</option>
            <option value="full">Full width</option>
          </select>
        </Row>
        <Row
          label="Expand sidebar on hover"
          description={
            cs.sidebarHoverExpand
              ? 'Collapsed sidebar expands temporarily on hover.'
              : 'Collapsed sidebar stays at 48px until you click the toggle.'
          }
        >
          <Switch
            checked={cs.sidebarHoverExpand}
            onCheckedChange={(c) => updateCS({ sidebarHoverExpand: c })}
            aria-label="Expand sidebar on hover"
          />
        </Row>
      </div>
      {/* Loading animation removed — not relevant for Hermes */}
    </div>
  )
}

function NotificationsContent() {
  const { settings, updateSettings } = useSettings()
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Notifications"
        description="Simple alerts and threshold controls."
      />
      <div className={SETTINGS_CARD_CLASS}>
        <Row label="Enable alerts">
          <Switch
            checked={settings.notificationsEnabled}
            onCheckedChange={(c) => updateSettings({ notificationsEnabled: c })}
            aria-label="Enable alerts"
          />
        </Row>
        <Row label="Usage threshold">
          <div className="flex w-full max-w-[14rem] items-center gap-2">
            <input
              type="range"
              min={50}
              max={100}
              value={settings.usageThreshold}
              onChange={(e) =>
                updateSettings({ usageThreshold: Number(e.target.value) })
              }
              className="w-full accent-primary-900 dark:accent-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!settings.notificationsEnabled}
              aria-label={`Usage threshold: ${settings.usageThreshold} percent`}
              aria-valuemin={50}
              aria-valuemax={100}
              aria-valuenow={settings.usageThreshold}
            />
            <span className="w-10 text-right text-sm tabular-nums text-primary-700 dark:text-neutral-300">
              {settings.usageThreshold}%
            </span>
          </div>
        </Row>
      </div>
    </div>
  )
}

// ── Error Boundary ──────────────────────────────────────────────────────

class SettingsErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center p-8 text-center">
          <div>
            <p className="mb-2 text-sm font-medium text-red-500">
              Settings failed to load
            </p>
            <button
              onClick={() => this.setState({ error: null })}
              className="text-xs text-primary-600 underline hover:text-primary-900"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ── Agent Behavior ──────────────────────────────────────────────────────

function AgentBehaviorContent() {
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/claude-config')
      .then((r) => r.json())
      .then((d: any) => {
        setConfig((d.config?.agent || {}) as Record<string, unknown>)
      })
      .catch(() => {})
  }, [])

  const save = async (key: string, value: unknown) => {
    setMsg(null)
    try {
      await fetch('/api/claude-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { agent: { [key]: value } } }),
      })
      setConfig((prev) => ({ ...prev, [key]: value }))
      setMsg('Saved')
      setTimeout(() => setMsg(null), 2000)
    } catch {
      setMsg('Failed')
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Agent Behavior"
        description="Execution limits and tool access."
      />
      {msg && (
        <div
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-medium',
            msg === 'Saved'
              ? 'bg-green-500/15 text-green-400'
              : 'bg-red-500/15 text-red-400',
          )}
        >
          {msg}
        </div>
      )}
      <div className={SETTINGS_CARD_CLASS}>
        <Row
          label="Max turns"
          description="Maximum agent turns per request (1-100)"
        >
          <input
            type="number"
            min={1}
            max={100}
            value={Number(config.max_turns) || 50}
            onChange={(e) => save('max_turns', Number(e.target.value))}
            className="h-8 w-20 rounded-lg border border-primary-200 bg-primary-50 px-2 text-sm text-center text-primary-900 outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </Row>
        <Row label="Gateway timeout" description="Seconds before timeout">
          <input
            type="number"
            min={10}
            max={600}
            value={Number(config.gateway_timeout) || 120}
            onChange={(e) => save('gateway_timeout', Number(e.target.value))}
            className="h-8 w-20 rounded-lg border border-primary-200 bg-primary-50 px-2 text-sm text-center text-primary-900 outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </Row>
        <Row label="Tool enforcement" description="When agent must use tools">
          <select
            value={String(config.tool_use_enforcement || 'auto')}
            onChange={(e) => save('tool_use_enforcement', e.target.value)}
            className="h-8 rounded-lg border border-primary-200 bg-primary-50 px-2 text-sm text-primary-900 outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          >
            <option value="auto">Auto</option>
            <option value="required">Required</option>
            <option value="none">None</option>
          </select>
        </Row>
      </div>
    </div>
  )
}

// ── Smart Routing ───────────────────────────────────────────────────────

function SmartRoutingContent() {
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [models, setModels] = useState<Array<{ id: string; name?: string }>>([])
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/claude-config')
      .then((r) => r.json())
      .then((d: any) => {
        setConfig(
          (d.config?.smart_model_routing || {}) as Record<string, unknown>,
        )
      })
      .catch(() => {})
    fetch('/api/models')
      .then((r) => r.json())
      .then((d: any) => {
        setModels(d.models || [])
      })
      .catch(() => {})
  }, [])

  const save = async (key: string, value: unknown) => {
    setMsg(null)
    try {
      await fetch('/api/claude-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: { smart_model_routing: { [key]: value } },
        }),
      })
      setConfig((prev) => ({ ...prev, [key]: value }))
      setMsg('Saved')
      setTimeout(() => setMsg(null), 2000)
    } catch {
      setMsg('Failed')
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Smart Routing"
        description="Route simple queries to cheaper models."
      />
      {msg && (
        <div
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-medium',
            msg === 'Saved'
              ? 'bg-green-500/15 text-green-400'
              : 'bg-red-500/15 text-red-400',
          )}
        >
          {msg}
        </div>
      )}
      <div className={SETTINGS_CARD_CLASS}>
        <Row
          label="Enable smart routing"
          description="Auto-route simple queries"
        >
          <Switch
            checked={config.enabled !== false}
            onCheckedChange={(c) => save('enabled', c)}
          />
        </Row>
        <Row label="Cheap model" description="Model for simple queries">
          <select
            value={String(config.cheap_model || '')}
            onChange={(e) => save('cheap_model', e.target.value)}
            className="h-8 max-w-[12rem] rounded-lg border border-primary-200 bg-primary-50 px-2 text-sm text-primary-900 outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          >
            <option value="">Auto</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.id}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Max chars" description="Messages shorter use cheap model">
          <input
            type="number"
            min={10}
            max={2000}
            value={Number(config.max_simple_chars) || 200}
            onChange={(e) => save('max_simple_chars', Number(e.target.value))}
            className="h-8 w-20 rounded-lg border border-primary-200 bg-primary-50 px-2 text-sm text-center text-primary-900 outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </Row>
        <Row
          label="Max words"
          description="Messages with fewer words use cheap model"
        >
          <input
            type="number"
            min={1}
            max={500}
            value={Number(config.max_simple_words) || 30}
            onChange={(e) => save('max_simple_words', Number(e.target.value))}
            className="h-8 w-20 rounded-lg border border-primary-200 bg-primary-50 px-2 text-sm text-center text-primary-900 outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </Row>
      </div>
    </div>
  )
}

// ── Voice (TTS + STT) ──────────────────────────────────────────────────

function VoiceContent() {
  const [tts, setTts] = useState<Record<string, unknown>>({})
  const [stt, setStt] = useState<Record<string, unknown>>({})
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/claude-config')
      .then((r) => r.json())
      .then((d: any) => {
        setTts((d.config?.tts || {}) as Record<string, unknown>)
        setStt((d.config?.stt || {}) as Record<string, unknown>)
      })
      .catch(() => {})
  }, [])

  const saveTts = async (key: string, value: unknown) => {
    setMsg(null)
    try {
      await fetch('/api/claude-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { tts: { [key]: value } } }),
      })
      setTts((prev) => ({ ...prev, [key]: value }))
      setMsg('Saved')
      setTimeout(() => setMsg(null), 2000)
    } catch {
      setMsg('Failed')
    }
  }

  const saveStt = async (key: string, value: unknown) => {
    setMsg(null)
    try {
      await fetch('/api/claude-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { stt: { [key]: value } } }),
      })
      setStt((prev) => ({ ...prev, [key]: value }))
      setMsg('Saved')
      setTimeout(() => setMsg(null), 2000)
    } catch {
      setMsg('Failed')
    }
  }

  const ttsProvider = String(tts.provider || 'edge')

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Voice"
        description="Text-to-speech and speech-to-text."
      />
      {msg && (
        <div
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-medium',
            msg === 'Saved'
              ? 'bg-green-500/15 text-green-400'
              : 'bg-red-500/15 text-red-400',
          )}
        >
          {msg}
        </div>
      )}
      <div className={SETTINGS_CARD_CLASS}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary-500">
          Text-to-Speech
        </p>
        <Row label="TTS Provider">
          <select
            value={ttsProvider}
            onChange={(e) => saveTts('provider', e.target.value)}
            className="h-8 rounded-lg border border-primary-200 bg-primary-50 px-2 text-sm text-primary-900 outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          >
            <option value="edge">Edge TTS</option>
            <option value="elevenlabs">ElevenLabs</option>
            <option value="openai">OpenAI TTS</option>
            <option value="neutts">NeuTTS</option>
          </select>
        </Row>
        {ttsProvider === 'openai' && (
          <Row label="Voice">
            <select
              value={String(
                (tts.openai as Record<string, unknown>).voice || 'nova',
              )}
              onChange={(e) =>
                saveTts('openai', {
                  ...(tts.openai as Record<string, unknown>),
                  voice: e.target.value,
                })
              }
              className="h-8 rounded-lg border border-primary-200 bg-primary-50 px-2 text-sm text-primary-900 outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            >
              {['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].map(
                (v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ),
              )}
            </select>
          </Row>
        )}
      </div>
      <div className={SETTINGS_CARD_CLASS}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary-500">
          Speech-to-Text
        </p>
        <Row label="Enable STT">
          <Switch
            checked={stt.enabled !== false}
            onCheckedChange={(c) => saveStt('enabled', c)}
          />
        </Row>
        <Row label="STT Provider">
          <select
            value={String(stt.provider || 'local')}
            onChange={(e) => saveStt('provider', e.target.value)}
            className="h-8 rounded-lg border border-primary-200 bg-primary-50 px-2 text-sm text-primary-900 outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          >
            <option value="local">Local (Whisper)</option>
            <option value="openai">OpenAI Whisper</option>
          </select>
        </Row>
      </div>
    </div>
  )
}

// ── Display ─────────────────────────────────────────────────────────────

function DisplayContent() {
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/claude-config')
      .then((r) => r.json())
      .then((d: any) => {
        setConfig((d.config?.display || {}) as Record<string, unknown>)
      })
      .catch(() => {})
  }, [])

  const save = async (key: string, value: unknown) => {
    setMsg(null)
    try {
      await fetch('/api/claude-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { display: { [key]: value } } }),
      })
      setConfig((prev) => ({ ...prev, [key]: value }))
      setMsg('Saved')
      setTimeout(() => setMsg(null), 2000)
    } catch {
      setMsg('Failed')
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Display"
        description="Agent response style and output preferences."
      />
      {msg && (
        <div
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-medium',
            msg === 'Saved'
              ? 'bg-green-500/15 text-green-400'
              : 'bg-red-500/15 text-red-400',
          )}
        >
          {msg}
        </div>
      )}
      <div className={SETTINGS_CARD_CLASS}>
        <Row label="Personality" description="Agent response style">
          <select
            value={String(config.personality || 'default')}
            onChange={(e) => save('personality', e.target.value)}
            className="h-8 rounded-lg border border-primary-200 bg-primary-50 px-2 text-sm text-primary-900 outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          >
            <option value="default">Default</option>
            <option value="concise">Concise</option>
            <option value="verbose">Verbose</option>
            <option value="creative">Creative</option>
          </select>
        </Row>
        <Row label="Streaming" description="Stream responses in real-time">
          <Switch
            checked={config.streaming !== false}
            onCheckedChange={(c) => save('streaming', c)}
          />
        </Row>
        <Row
          label="Show reasoning"
          description="Display model thinking process"
        >
          <Switch
            checked={config.show_reasoning !== false}
            onCheckedChange={(c) => save('show_reasoning', c)}
          />
        </Row>
        <Row label="Show cost" description="Display token cost per response">
          <Switch
            checked={config.show_cost === true}
            onCheckedChange={(c) => save('show_cost', c)}
          />
        </Row>
        <Row label="Compact mode" description="Reduce spacing in responses">
          <Switch
            checked={config.compact === true}
            onCheckedChange={(c) => save('compact', c)}
          />
        </Row>
      </div>
    </div>
  )
}

function LanguageContent() {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Language"
        description="Choose the display language for the workspace UI."
      />
      <Row
        label="Interface Language"
        description="Translates navigation, labels, and buttons."
      >
        <select
          value={getLocale()}
          onChange={(e) => {
            setLocale(e.target.value as LocaleId)
            window.location.reload()
          }}
          className="h-9 w-full rounded-lg border border-primary-200 dark:border-neutral-700 bg-primary-50 dark:bg-neutral-800 px-3 text-sm text-primary-900 dark:text-neutral-100 outline-none md:max-w-xs"
        >
          {(Object.entries(LOCALE_LABELS) as Array<[LocaleId, string]>).map(
            ([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ),
          )}
        </select>
      </Row>
    </div>
  )
}

// ── Main Dialog ─────────────────────────────────────────────────────────

const CONTENT_MAP: Record<SectionId, () => React.JSX.Element> = {
  claude: HermesContent,
  agent: AgentBehaviorContent,
  routing: SmartRoutingContent,
  voice: VoiceContent,
  display: DisplayContent,
  appearance: AppearanceContent,
  chat: ChatContent,
  notifications: NotificationsContent,
  language: LanguageContent,
}

type SettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialSection?: SectionId
}

export function SettingsDialog({
  open,
  onOpenChange,
  initialSection = 'claude',
}: SettingsDialogProps) {
  const [active, setActive] = useState<SectionId>(initialSection)
  const [mobileView, setMobileView] = useState<'nav' | 'content'>('nav')
  const ActiveContent = CONTENT_MAP[active]

  useEffect(() => {
    if (open) {
      setActive(initialSection)
      setMobileView('nav')
    }
  }, [initialSection, open])

  function handleSectionSelect(sectionId: SectionId) {
    setActive(sectionId)
    setMobileView('content')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-mset="dialog"
        className="inset-0 h-full w-full max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 p-0 shadow-xl md:inset-auto md:left-1/2 md:top-1/2 md:h-[min(88dvh,740px)] md:min-h-[520px] md:w-full md:max-w-3xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border md:border-primary-200 bg-[var(--theme-bg)]"
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-primary-200 bg-primary-50/80 px-4 py-4 md:rounded-t-2xl md:px-5">
            <div>
              <DialogTitle className="text-base font-semibold text-primary-900 dark:text-neutral-100">
                Settings
              </DialogTitle>
              <DialogDescription className="sr-only">
                Configure Hermes Switch UI
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                className="rounded-full text-primary-500 hover:bg-primary-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                aria-label="Close"
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  size={18}
                  strokeWidth={1.5}
                />
              </Button>
            </DialogClose>
          </div>

          <SettingsErrorBoundary>
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              <aside
                className={cn(
                  'w-full bg-primary-50/60 p-2 md:w-44 md:shrink-0 md:border-r md:border-primary-200',
                  mobileView === 'content' && 'hidden md:block',
                )}
              >
                <nav className="space-y-1">
                  {SECTIONS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handleSectionSelect(s.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-primary-600 transition-colors hover:bg-primary-100',
                        active === s.id &&
                          'bg-accent-50 font-medium text-accent-700',
                      )}
                    >
                      <HugeiconsIcon
                        icon={s.icon}
                        size={16}
                        strokeWidth={1.5}
                      />
                      {s.label}
                    </button>
                  ))}
                </nav>
              </aside>
              <div
                className={cn(
                  'min-w-0 flex-1 overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:p-5 md:pb-5',
                  mobileView === 'nav' && 'hidden md:block',
                )}
              >
                <div className="mb-3 md:hidden">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setMobileView('nav')}
                    className="h-8 gap-1.5 rounded-lg px-2 text-primary-600 hover:bg-primary-100"
                  >
                    <HugeiconsIcon
                      icon={ArrowLeft01Icon}
                      size={16}
                      strokeWidth={1.5}
                    />
                    Back
                  </Button>
                </div>
                <ActiveContent />
              </div>
            </div>
          </SettingsErrorBoundary>

          <div className="sticky bottom-0 z-10 border-t border-primary-200 bg-primary-50/60 px-4 py-3 text-xs text-primary-500 dark:text-neutral-400 md:rounded-b-2xl md:px-5">
            Changes saved automatically.{' '}
            <a
              href="/settings"
              className="ml-2 font-medium underline underline-offset-2 hover:text-primary-700 dark:hover:text-neutral-200"
            >
              All settings →
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
