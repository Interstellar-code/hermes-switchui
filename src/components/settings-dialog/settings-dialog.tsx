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
import type { AccentColor, SettingsThemeMode } from '@/hooks/use-settings'
import type { LoaderStyle } from '@/hooks/use-chat-settings'
import type { BrailleSpinnerPreset } from '@/components/ui/braille-spinner'
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
import {
  getChatProfileDisplayName,
  useChatSettingsStore,
} from '@/hooks/use-chat-settings'
import { UserAvatar } from '@/components/avatars'
import { Input } from '@/components/ui/input'
import { LogoLoader } from '@/components/logo-loader'
import { BrailleSpinner } from '@/components/ui/braille-spinner'
import { ThreeDotsSpinner } from '@/components/ui/three-dots-spinner'
import BackendUnavailableState from '@/components/backend-unavailable-state'
import { applyAccentColor } from '@/lib/accent-colors'
import { getUnavailableReason } from '@/lib/feature-gates'
import { useFeatureAvailable } from '@/hooks/use-feature-available'
import { ProviderLogo } from '@/components/provider-logo'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'

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
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        <p className="desc">{description}</p>
      </div>
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
    <div className="row">
      <div className="lbl">
        <p>{label}</p>
        {description && (
          <p className="desc">{description}</p>
        )}
      </div>
      <div className="ctl">{children}</div>
    </div>
  )
}

const SETTINGS_CARD_CLASS =
  'card'

// ── Section components ──────────────────────────────────────────────────

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
    envKey: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'nous',
    name: 'Nous Portal',
    logo: '/providers/nous.png',
    models: ['xiaomi/mimo-v2-pro', 'xiaomi/mimo-v2-omni', 'claude-3-llama-3.1-405b', 'claude-3-llama-3.1-70b'],
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
    envKey: 'OPENROUTER_API_KEY',
  },
  {
    id: 'zai',
    name: 'Z.AI / GLM',
    logo: '/providers/zhipu.png',
    models: ['glm-4-plus', 'glm-4-air'],
    authType: 'api_key',
    envKey: 'GLM_API_KEY',
  },
  {
    id: 'kimi-coding',
    name: 'Kimi',
    logo: '/providers/kimi.png',
    models: ['kimi-latest', 'moonshot-v1-128k'],
    authType: 'api_key',
    envKey: 'KIMI_API_KEY',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    logo: '/providers/minimax.png',
    models: ['MiniMax-M2.7', 'MiniMax-M2.7-Lightning'],
    authType: 'api_key',
    envKey: 'MINIMAX_API_KEY',
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi MiMo',
    logo: '/providers/xiaomi.png',
    models: ['mimo-v2-pro', 'mimo-v2-omni', 'mimo-v2-flash'],
    authType: 'api_key',
    envKey: 'XIAOMI_API_KEY',
  },
  { id: 'custom', name: 'Custom', logo: '', models: [], authType: 'api_key', envKey: 'CUSTOM_API_KEY' },
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
    providers: Array<{ id: string; name: string; online: boolean; modelCount: number; configured: boolean; needsRestart: boolean }>
    models: Array<{ id: string; name: string; provider: string }>
  } | null>(null)

  const fetchModelsForProvider = useCallback((providerId: string) => {
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
  }, [localDiscovery])

  useEffect(() => {
    fetch('/api/local-providers')
      .then((r) => r.json())
      .then((d: any) => { if (d.ok) setLocalDiscovery(d) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/claude-config')
      .then((r) => r.json())
      .then((d: any) => {
        setActiveProvider(d.activeProvider || '')
        setActiveModel(d.activeModel || '')
        if (d.activeProvider) fetchModelsForProvider(d.activeProvider)
        const mem = (d.config?.memory as Record<string, unknown>) || {}
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
        const cfgProviders = (d.config?.providers as Record<string, any>) || {}
        const customCfg = cfgProviders['custom'] || cfgProviders['manifest'] || {}
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

  return (
    <div className="section-stack">
      {msg && (
        <div
          className={cn(
            msg.includes('Failed') ? 'message-error' : 'message-success'
          )}
        >
          {msg}
        </div>
      )}

      {/* Provider Selection */}
      <div className="card">
        <h3><span className="ic">◈</span> Provider <span className="sub">Select AI backend</span></h3>
        <div style={{ padding: '14px 18px' }}>
          <div className="providers-grid">
            {PROVIDER_CARDS.map((p) => {
              const isActive = activeProvider === p.id
              const localOnline =
                localDiscovery?.providers.find((lp) => lp.id === p.id)?.online ===
                true
              const verified =
                (p.authType === 'none' && localOnline) ||
                (p.authType === 'api_key' &&
                  !!p.envKey &&
                  !!configuredKeys[p.envKey])
              const missingKey = p.authType === 'api_key' && !verified && p.id !== 'custom'
              const hasKey =
                p.authType === 'none' || p.authType === 'oauth' || verified || p.id === 'custom'
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    if (hasKey) selectProvider(p.id)
                  }}
                  className={cn(
                    'provider-tile',
                    isActive && 'on',
                    missingKey && 'dim',
                  )}
                >
                  <div className="tile-top">
                    <ProviderLogo provider={p.id} size={28} />
                    {isActive ? (
                      <span className="dot ok" />
                    ) : missingKey ? (
                      <span className="dot" style={{ background: '#ff5fa2' }} />
                    ) : verified ? (
                      <span className="dot" style={{ background: 'var(--m-green-500)', opacity: 0.5 }} />
                    ) : null}
                  </div>
                  <span className="tile-name">{p.name}</span>
                  <span className="tile-sub">
                    {(() => {
                      const disc = localDiscovery?.providers.find((lp) => lp.id === p.id)
                      if (disc?.online) return 'Detected'
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
      </div>

      {/* Model Selection for active provider */}
      {activeProvider && (
        <div className="card">
          <h3><span className="ic">◈</span> Model</h3>
          <div style={{ padding: '14px 18px' }}>
            <div className="model-chips">
              {(() => {
                if (availableModels.length > 0) return availableModels
                const discovered = localDiscovery?.models
                  .filter((m) => m.provider === activeProvider)
                  .map((m) => m.id)
                if (discovered && discovered.length > 0) return discovered
                return PROVIDER_CARDS.find((p) => p.id === activeProvider)?.models || []
              })().map((model) => (
                <button
                  key={model}
                  type="button"
                  onClick={() => selectProvider(activeProvider, model)}
                  className={cn('model-chip', activeModel === model && 'on')}
                >
                  {model}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Custom OpenAI-compatible endpoint fields — Base URL only; API key lives in API Keys section */}
      {activeProvider === 'custom' && (
        <div className="card">
          <h3><span className="ic">◈</span> Custom Endpoint</h3>
          <div>
            {(() => {
              const isEditing = editingKey === 'custom_base_url'
              const hasValue = !!customBaseUrl
              return (
                <div className="row">
                  <div className="lbl">
                    <p>Base URL</p>
                    {isEditing ? (
                      <input
                        type="url"
                        value={customBaseUrl}
                        onChange={(e) => setCustomBaseUrl(e.target.value)}
                        placeholder="http://127.0.0.1:38238/v1"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            save({ config: { model: { provider: 'manifest' }, providers: { manifest: { type: 'openai', base_url: customBaseUrl, key_env: 'CUSTOM_API_KEY' } } } })
                              .then(() => setEditingKey(null))
                          }
                          if (e.key === 'Escape') setEditingKey(null)
                        }}
                      />
                    ) : (
                      <span className="desc">{hasValue ? customBaseUrl : 'Not configured'}</span>
                    )}
                  </div>
                  <div className="ctl">
                    {isEditing ? (
                      <>
                        <button type="button" onClick={() => { save({ config: { model: { provider: 'manifest' }, providers: { manifest: { type: 'openai', base_url: customBaseUrl, key_env: 'CUSTOM_API_KEY' } } } }).then(() => setEditingKey(null)) }} className="btn primary">Save</button>
                        <button type="button" onClick={() => setEditingKey(null)} className="btn">Cancel</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setEditingKey('custom_base_url')} className="btn">
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
        const disc = localDiscovery?.providers.find((lp) => lp.id === activeProvider)
        if (!disc || !disc.needsRestart) return null
        return (
          <div className="warning-box">
            Gateway restart needed to use {disc.name}. Run <code>hermes gateway restart</code> in your terminal.
          </div>
        )
      })()}

      {/* API Keys */}
      <div className="card">
        <h3><span className="ic">◈</span> API Keys</h3>
        <div>
          {PROVIDER_CARDS.filter((p) => p.envKey).map((p) => {
            const key = p.envKey!
            const hasKey = !!configuredKeys[key]
            const isEditing = editingKey === key
            return (
              <div
                key={p.id}
                className="row"
              >
                <div className="lbl">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <ProviderLogo provider={p.id} size={20} />
                    <p>{p.name}</p>
                  </div>
                  {isEditing ? (
                    <input
                      type="password"
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      placeholder={`Paste ${key}`}
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
                  ) : (
                    <span className="desc">{hasKey ? configuredKeys[key] : 'Not configured'}</span>
                  )}
                </div>
                <div className="ctl row-end">
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
                        className="btn primary"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingKey(null)
                          setKeyInput('')
                        }}
                        className="btn"
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
                      className="btn"
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
      <div className="card">
        <h3><span className="ic">◈</span> Memory</h3>
        <div className="row">
          <div className="lbl">
            <p>Memory</p>
            <p className="desc">Store &amp; recall memories across sessions</p>
          </div>
          <div className="ctl">
            <Switch
              checked={memEnabled}
              onCheckedChange={(c) => {
                setMemEnabled(c)
                save({ config: { memory: { memory_enabled: c } } })
              }}
            />
          </div>
        </div>
        <div className="row">
          <div className="lbl">
            <p>User Profile</p>
            <p className="desc">Remember preferences &amp; context</p>
          </div>
          <div className="ctl">
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
      <div className="card">
        <h3><span className="ic">◈</span> Runtime</h3>
        <table className="mini-table">
          <tbody>
            <tr>
              <td style={{ color: 'var(--m-text-faint)' }}>Model</td>
              <td>{activeModel || '—'}</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--m-text-faint)' }}>Provider</td>
              <td>
                {PROVIDER_CARDS.find((p) => p.id === activeProvider)?.name ||
                  activeProvider ||
                  '—'}
              </td>
            </tr>
            <tr>
              <td style={{ color: 'var(--m-text-faint)' }}>Config</td>
              <td>~/.hermes/config.yaml</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function _ProfileContent() {
  const { settings: cs, updateSettings: updateCS } = useChatSettingsStore()
  const [profileError, setProfileError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const displayName = getChatProfileDisplayName(cs.displayName)
  const [nameError, setNameError] = useState<string | null>(null)

  function handleNameChange(value: string) {
    if (value.length > 50) {
      setNameError('Display name too long (max 50 characters)')
      return
    }
    setNameError(null)
    updateCS({ displayName: value })
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setProfileError('Unsupported file type.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setProfileError('Image too large (max 10MB).')
      return
    }
    setProfileError(null)
    setProcessing(true)
    try {
      const url = URL.createObjectURL(file)
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image()
        i.onload = () => resolve(i)
        i.onerror = () => reject(new Error('Failed'))
        i.src = url
      })
      const max = 128,
        scale = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale),
        h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      updateCS({
        avatarDataUrl: canvas.toDataURL(
          file.type === 'image/png' ? 'image/png' : 'image/jpeg',
          0.82,
        ),
      })
    } catch {
      setProfileError('Failed to process image.')
    } finally {
      setProcessing(false)
    }
  }

  const errorId = 'profile-name-error'

  return (
    <div className="section-stack">
      <SectionHeader
        title="Profile"
        description="Your display identity in chat."
      />
      <div className={SETTINGS_CARD_CLASS}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px' }}>
          <UserAvatar size={44} src={cs.avatarDataUrl} alt={displayName} />
          <div>
            <p style={{ fontFamily: 'var(--m-font-mono)', fontWeight: 600, fontSize: '13px', color: 'var(--m-text-strong)', margin: 0 }}>
              {displayName}
            </p>
            <p style={{ fontFamily: 'var(--m-font-mono)', fontSize: '11px', color: 'var(--m-text-faint)', margin: 0 }}>
              No email connected
            </p>
          </div>
        </div>
      </div>
      <div className={SETTINGS_CARD_CLASS}>
        <Row label="Display name" description="Shown in chat and sidebar">
          <div>
            <Input
              value={cs.displayName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="User"
              maxLength={50}
              aria-label="Display name"
              aria-invalid={!!nameError}
              aria-describedby={nameError ? errorId : undefined}
            />
            {nameError && (
              <p
                id={errorId}
                className="mt-1 text-xs message-error" style={{ padding: '4px 8px', marginTop: '4px' }}
                role="alert"
              >
                {nameError}
              </p>
            )}
          </div>
        </Row>
        <Row label="Avatar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label>
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                disabled={processing}
                aria-label="Upload profile picture"
                className="btn"
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateCS({ avatarDataUrl: null })}
              disabled={!cs.avatarDataUrl || processing}
              className="btn"
            >
              Remove
            </Button>
          </div>
          {profileError && (
            <p className="text-xs message-error" style={{ padding: '4px 8px', marginTop: '4px' }} role="alert">
              {profileError}
            </p>
          )}
        </Row>
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

  function _badgeClass(color: AccentColor): string {
    if (color === 'orange') return 'bg-orange-500'
    if (color === 'purple') return 'bg-purple-500'
    if (color === 'blue') return 'bg-blue-500'
    return 'bg-green-500'
  }

  function _handleAccentColorChange(selectedAccent: AccentColor) {
    localStorage.setItem('claude-accent', selectedAccent)
    document.documentElement.setAttribute('data-accent', selectedAccent)
    applyAccentColor(selectedAccent)
    updateSettings({ accentColor: selectedAccent })
  }

  return (
    <div className="section-stack">
      <SectionHeader
        title="Appearance"
        description="Theme and color accents."
      />
      <div className={SETTINGS_CARD_CLASS}>
        <h3><span className="ic">◈</span> Theme Mode</h3>
        <div className="row">
          <div className="lbl">
            <p>Mode</p>
            <span className="desc">Light, dark, or follow system preference.</span>
          </div>
          <div className="ctl">
            <div style={{ display: 'flex', gap: '4px' }}>
              {[
                { value: 'light', label: 'Light', icon: Sun01Icon },
                { value: 'dark', label: 'Dark', icon: Moon01Icon },
                { value: 'system', label: 'System', icon: ComputerIcon },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleThemeChange(option.value)}
                  className={cn('btn', settings.theme === option.value && 'primary')}
                >
                  <HugeiconsIcon icon={option.icon} size={14} strokeWidth={1.5} />
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* Accent color removed — themes control accent */}
      <div className={SETTINGS_CARD_CLASS}>
        <h3><span className="ic">◈</span> Theme Family</h3>
        <div style={{ padding: '14px 18px' }}>
          <EnterpriseThemePicker />
        </div>
      </div>
      <div className={SETTINGS_CARD_CLASS}>
        <Row
          label="System metrics footer"
          description="Show a persistent footer with CPU, RAM, disk, and Hermes Agent status."
        >
          <Switch
            checked={settings.showSystemMetricsFooter}
            onCheckedChange={(c) =>
              updateSettings({ showSystemMetricsFooter: c })
            }
            aria-label="Show system metrics footer"
          />
        </Row>

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div className="row" style={{ borderBottom: '1px solid var(--m-border-subtle)' }}>
        <div className="lbl">
          <p>{currentMode === 'dark' ? 'Dark mode' : 'Light mode'}</p>
          <span className="desc">Toggle between light and dark variants.</span>
        </div>
        <div className="ctl row-end">
          <button
            type="button"
            onClick={toggleEnterpriseThemeMode}
            className="btn"
            aria-label={
              currentMode === 'dark'
                ? 'Switch matrix theme to light mode'
                : 'Switch matrix theme to dark mode'
            }
          >
            <HugeiconsIcon
              icon={currentMode === 'dark' ? Sun01Icon : Moon01Icon}
              size={14}
              strokeWidth={1.5}
            />
            {currentMode === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
        {visibleThemes.map((t) => {
          const isActive = current === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => applyEnterpriseTheme(t.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                borderRadius: 'var(--m-radius-md)',
                border: isActive ? '1px solid var(--m-green-500)' : '1px solid var(--m-border)',
                background: isActive ? 'rgba(0,255,65,0.06)' : 'var(--m-bg-deep)',
                padding: '8px',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'border-color 0.12s, background 0.12s',
              }}
            >
              <ThemeSwatch colors={t.preview} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '11px' }}>{t.icon}</span>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--m-text)', fontFamily: 'var(--m-font-mono)' }}>
                  {t.label}
                </span>
                {isActive && (
                  <span style={{ marginLeft: 'auto', fontSize: '9px', fontWeight: 700, color: 'var(--m-green-500)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    Active
                  </span>
                )}
              </div>
              <p style={{ fontSize: '10px', color: 'var(--m-text-faint)', lineHeight: 1.4, margin: 0 }}>
                {t.desc}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function _LoaderContent() {
  const { settings: cs, updateSettings: updateCS } = useChatSettingsStore()
  const styles: Array<{ value: LoaderStyle; label: string }> = [
    { value: 'dots', label: 'Dots' },
    { value: 'braille-claude', label: 'Hermes' },
    { value: 'braille-orbit', label: 'Orbit' },
    { value: 'braille-breathe', label: 'Breathe' },
    { value: 'braille-pulse', label: 'Pulse' },
    { value: 'braille-wave', label: 'Wave' },
    { value: 'lobster', label: 'Lobster' },
    { value: 'logo', label: 'Logo' },
  ]
  function getPreset(s: LoaderStyle): BrailleSpinnerPreset | null {
    const m: Record<string, BrailleSpinnerPreset> = {
      'braille-claude': 'claude',
      'braille-orbit': 'orbit',
      'braille-breathe': 'breathe',
      'braille-pulse': 'pulse',
      'braille-wave': 'wave',
    }
    return m[s] ?? null
  }
  function Preview({ style }: { style: LoaderStyle }) {
    if (style === 'dots') return <ThreeDotsSpinner />
    if (style === 'lobster')
      return <span className="inline-block text-sm animate-pulse">🦞</span>
    if (style === 'logo') return <LogoLoader />
    const p = getPreset(style)
    return p ? (
      <BrailleSpinner
        preset={p}
        size={16}
        speed={120}
        color="var(--m-text-faint)"
      />
    ) : (
      <ThreeDotsSpinner />
    )
  }
  return (
    <div>
      <div className="loader-grid">
        {styles.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => updateCS({ loaderStyle: o.value })}
            className={cn('loader-chip', cs.loaderStyle === o.value && 'on')}
            aria-pressed={cs.loaderStyle === o.value}
          >
            <span style={{ display: 'flex', height: '16px', alignItems: 'center', justifyContent: 'center' }}>
              <Preview style={o.value} />
            </span>
            <span>{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ChatContent() {
  const { settings: cs, updateSettings: updateCS } = useChatSettingsStore()
  return (
    <div className="section-stack">
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
                chatWidth: e.target.value as
                  | 'comfortable'
                  | 'wide'
                  | 'full',
              })
            }
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
    <div className="section-stack">
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="range"
              min={50}
              max={100}
              value={settings.usageThreshold}
              onChange={(e) =>
                updateSettings({ usageThreshold: Number(e.target.value) })
              }
              disabled={!settings.notificationsEnabled}
              aria-label={`Usage threshold: ${settings.usageThreshold} percent`}
              aria-valuemin={50}
              aria-valuemax={100}
              aria-valuenow={settings.usageThreshold}
            />
            <span style={{ fontFamily: 'var(--m-font-mono)', fontSize: '12px', color: 'var(--m-text)', minWidth: '36px', textAlign: 'right' }}>
              {settings.usageThreshold}%
            </span>
          </div>
        </Row>
      </div>
    </div>
  )
}

function _AdvancedContent() {
  const { settings, updateSettings } = useSettings()
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'testing' | 'connected' | 'failed'
  >('idle')
  const [urlError, setUrlError] = useState<string | null>(null)

  function validateAndUpdateUrl(value: string) {
    if (value && value.length > 0) {
      try {
        new URL(value)
        setUrlError(null)
      } catch {
        setUrlError('Invalid URL format')
      }
    } else {
      setUrlError(null)
    }
    updateSettings({ claudeUrl: value })
  }

  async function testConnection() {
    if (urlError) return
    setConnectionStatus('testing')
    try {
      const r = await fetch('/api/ping')
      setConnectionStatus(r.ok ? 'connected' : 'failed')
    } catch {
      setConnectionStatus('failed')
    }
  }

  const urlErrorId = 'claude-url-error'

  return (
    <div className="section-stack">
      <SectionHeader
        title="Advanced"
        description="Hermes Agent endpoint and connectivity."
      />
      <div className={SETTINGS_CARD_CLASS}>
        <Row label="Hermes Agent URL" description="Used for API requests from Studio">
          <div>
            <Input
              type="url"
              placeholder="http://127.0.0.1:8642"
              value={settings.claudeUrl}
              onChange={(e) => validateAndUpdateUrl(e.target.value)}
              aria-label="Hermes Agent URL"
              aria-invalid={!!urlError}
              aria-describedby={urlError ? urlErrorId : undefined}
            />
            {urlError && (
              <p
                id={urlErrorId}
                className="mt-1 text-xs message-error" style={{ padding: '4px 8px', marginTop: '4px' }}
                role="alert"
              >
                {urlError}
              </p>
            )}
          </div>
        </Row>
        <Row label="Connection status">
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '9999px',
              border: '1px solid',
              padding: '2px 8px',
              fontSize: '11px',
              fontWeight: 500,
              fontFamily: 'var(--m-font-mono)',
              ...(connectionStatus === 'connected' ? { borderColor: 'var(--m-green-500)', background: 'rgba(0,255,65,0.08)', color: 'var(--m-green-500)' } :
                 connectionStatus === 'failed' ? { borderColor: 'rgba(255,95,162,0.4)', background: 'rgba(255,95,162,0.08)', color: '#ff5fa2' } :
                 connectionStatus === 'testing' ? { borderColor: 'var(--m-border)', background: 'var(--m-bg-deep)', color: 'var(--m-text-muted)' } :
                 { borderColor: 'var(--m-border)', background: 'var(--m-bg-deep)', color: 'var(--m-text-faint)' }),
            }}
          >
            {connectionStatus === 'idle'
              ? 'Not tested'
              : connectionStatus === 'testing'
                ? 'Testing...'
                : connectionStatus === 'connected'
                  ? 'Connected'
                  : 'Failed'}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void testConnection()}
            disabled={connectionStatus === 'testing' || !!urlError}
            className="btn"
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={16}
              strokeWidth={1.5}
            />
            Test
          </Button>
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
            <p className="mb-2 text-sm font-medium" style={{ color: '#ff5fa2' }}>
              Settings failed to load
            </p>
            <button
              onClick={() => this.setState({ error: null })}
              className="text-xs underline" style={{ color: 'var(--m-green-500)' }}
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
        setConfig((d.config?.agent as Record<string, unknown>) || {})
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
    <div className="section-stack">
      <SectionHeader
        title="Agent Behavior"
        description="Execution limits and tool access."
      />
      {msg && (
        <div
          className={cn(
            msg === 'Saved' ? 'message-success' : 'message-error'
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
            style={{ width: '80px', textAlign: 'center' }}
          />
        </Row>
        <Row label="Gateway timeout" description="Seconds before timeout">
          <input
            type="number"
            min={10}
            max={600}
            value={Number(config.gateway_timeout) || 120}
            onChange={(e) => save('gateway_timeout', Number(e.target.value))}
            style={{ width: '80px', textAlign: 'center' }}
          />
        </Row>
        <Row label="Tool enforcement" description="When agent must use tools">
          <select
            value={String(config.tool_use_enforcement || 'auto')}
            onChange={(e) => save('tool_use_enforcement', e.target.value)}
            className="h-8 rounded-md px-2 text-sm outline-none"
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
          (d.config?.smart_model_routing as Record<string, unknown>) || {},
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
    <div className="section-stack">
      <SectionHeader
        title="Smart Routing"
        description="Route simple queries to cheaper models."
      />
      {msg && (
        <div
          className={cn(
            msg === 'Saved' ? 'message-success' : 'message-error'
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
            style={{ maxWidth: '192px' }}
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
            style={{ width: '80px', textAlign: 'center' }}
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
            style={{ width: '80px', textAlign: 'center' }}
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
        setTts((d.config?.tts as Record<string, unknown>) || {})
        setStt((d.config?.stt as Record<string, unknown>) || {})
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
    <div className="section-stack">
      <SectionHeader
        title="Voice"
        description="Text-to-speech and speech-to-text."
      />
      {msg && (
        <div
          className={cn(
            msg === 'Saved' ? 'message-success' : 'message-error'
          )}
        >
          {msg}
        </div>
      )}
      <div className={SETTINGS_CARD_CLASS}>
        <h3><span className="ic">◈</span> Text-to-Speech</h3>
        <Row label="TTS Provider">
          <select
            value={ttsProvider}
            onChange={(e) => saveTts('provider', e.target.value)}
            className="h-8 rounded-md px-2 text-sm outline-none"
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
                (tts.openai as Record<string, unknown>)?.voice || 'nova',
              )}
              onChange={(e) =>
                saveTts('openai', {
                  ...((tts.openai as Record<string, unknown>) || {}),
                  voice: e.target.value,
                })
              }
              className="h-8 rounded-md px-2 text-sm outline-none"
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
        <h3><span className="ic">◈</span> Speech-to-Text</h3>
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
            className="h-8 rounded-md px-2 text-sm outline-none"
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
        setConfig((d.config?.display as Record<string, unknown>) || {})
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
    <div className="section-stack">
      <SectionHeader
        title="Display"
        description="Agent response style and output preferences."
      />
      {msg && (
        <div
          className={cn(
            msg === 'Saved' ? 'message-success' : 'message-error'
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
            className="h-8 rounded-md px-2 text-sm outline-none"
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

// ── Language ────────────────────────────────────────────────────────────

import { getLocale, setLocale, LOCALE_LABELS, type LocaleId } from '@/lib/i18n'

function LanguageContent() {
  return (
    <div className="section-stack">
      <SectionHeader
        title="Language"
        description="Choose the display language for the workspace UI."
      />
      <Row label="Interface Language" description="Translates navigation, labels, and buttons.">
        <select
          value={getLocale()}
          onChange={(e) => {
            setLocale(e.target.value as LocaleId)
            window.location.reload()
          }}
          style={{ maxWidth: '260px' }}
        >
          {(Object.entries(LOCALE_LABELS) as Array<[LocaleId, string]>).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
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
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-screen="settings"
        className="inset-0 h-full w-full max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 p-0 shadow-xl md:inset-auto md:left-1/2 md:top-1/2 md:h-[min(88dvh,740px)] md:min-h-[520px] md:w-full md:max-w-3xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border bg-[var(--m-bg)]">
        <div className="flex h-full min-h-0 flex-col">
          <div className="topbar">
            <div>
              <DialogTitle className="font-semibold">
                Settings
              </DialogTitle>
              <DialogDescription className="sr-only">
                Configure Hermes Workspace
              </DialogDescription>
            </div>
            <DialogClose
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="rounded-full"
                  style={{ color: 'var(--m-text-faint)' }}
                  aria-label="Close"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={18}
                    strokeWidth={1.5}
                  />
                </Button>
              }
            />
          </div>

          <SettingsErrorBoundary>
            <div className="body">
              <aside
                className={cn(
                  'side',
                  mobileView === 'content' && 'hidden md:block',
                )}
              >
                <nav>
                  {SECTIONS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handleSectionSelect(s.id)}
                      className={cn(
                        'item',
                        active === s.id && 'on',
                      )}
                    >
                      <HugeiconsIcon
                        icon={s.icon}
                        size={16}
                        strokeWidth={1.5}
                      />
                      <span>{s.label}</span>
                    </button>
                  ))}
                </nav>
              </aside>
              <div
                className={cn(
                  'content',
                  mobileView === 'nav' && 'hidden md:block',
                )}
              >
                <div className="mb-3 md:hidden">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setMobileView('nav')}
                  >
                    <HugeiconsIcon
                      icon={ArrowLeft01Icon}
                      size={16}
                      strokeWidth={1.5}
                    />
                    Back
                  </button>
                </div>
                <ActiveContent />
              </div>
            </div>
          </SettingsErrorBoundary>

          <div className="save-bar">
            <span>Changes saved automatically.</span>
            <span className="spacer"></span>
            <a
              href="/settings"
              className="font-medium underline underline-offset-2"
              style={{ color: 'var(--m-green-500)' }}
            >
              All settings →
            </a>
          </div>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
