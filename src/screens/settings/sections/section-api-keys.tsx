/**
 * section-api-keys.tsx — API Keys & OAuth section (P5).
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { PasswordField } from '../components/controls'
import type {EnvVarInfo, OAuthProvider} from '@/server/hermes-api';
import {
  
  
  deleteEnv,
  deleteOAuth,
  getEnv,
  listOAuthProviders,
  putEnv,
  revealEnv
} from '@/server/hermes-api'
import { ConfirmDialog } from '@/screens/profiles/components/confirm-dialog'
import { toast } from '@/components/ui/toast'

// ── Helpers ───────────────────────────────────────────────────────

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// ── EnvRow ────────────────────────────────────────────────────────

function EnvRow({ envKey, info }: { envKey: string; info: EnvVarInfo }) {
  const qc = useQueryClient()
  const [revealedValue, setRevealedValue] = useState<string | null>(null)
  const [revealTimer, setRevealTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  async function handleReveal() {
    if (revealedValue !== null) {
      // re-mask
      setRevealedValue(null)
      if (revealTimer) clearTimeout(revealTimer)
      setRevealTimer(null)
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

  function handleEditOpen() {
    setEditValue('')
    setEditing(true)
  }

  async function handleEditSave() {
    if (!editValue.trim()) {
      toast('Value cannot be empty', { type: 'error' })
      return
    }
    try {
      await putEnv(envKey, editValue.trim())
      await qc.invalidateQueries({ queryKey: ['env'] })
      setEditing(false)
      toast(`${humanizeKey(envKey)} updated`, { type: 'success' })
    } catch {
      toast('Failed to update key', { type: 'error' })
    }
  }

  async function handleDelete() {
    try {
      await deleteEnv(envKey)
      await qc.invalidateQueries({ queryKey: ['env'] })
      toast(`${humanizeKey(envKey)} deleted`, { type: 'success' })
    } catch {
      toast('Failed to delete key', { type: 'error' })
    } finally {
      setConfirmDeleteOpen(false)
    }
  }

  const displayValue = revealedValue || info.redacted_value || ''
  const label = info.description ? info.description : humanizeKey(envKey)

  return (
    <>
      <SettingRow
        label={label}
        desc={envKey}
        pill={info.is_set ? { t: 'set' } : { t: 'missing' }}
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
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleEditSave()}>Save</button>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            </>
          ) : (
            <>
              <PasswordField
                value={displayValue}
                masked={revealedValue === null}
                onChange={() => undefined}
                disabled
              />
              <button type="button" className="btn btn-sm" onClick={() => void handleReveal()}>
                {revealedValue !== null ? 'Hide' : 'Reveal'}
              </button>
              <button type="button" className="btn btn-sm" onClick={handleEditOpen}>Edit</button>
              {info.is_set && (
                <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmDeleteOpen(true)}>Delete</button>
              )}
            </>
          )}
        </div>
      </SettingRow>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete environment variable"
        message={`Remove ${humanizeKey(envKey)}? This may break features that depend on it.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </>
  )
}

// ── OAuthRow ──────────────────────────────────────────────────────

function OAuthRow({ provider }: { provider: OAuthProvider }) {
  const qc = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)

  async function handleSignOut() {
    try {
      await deleteOAuth(provider.id)
      await qc.invalidateQueries({ queryKey: ['oauth-providers'] })
      toast(`Signed out of ${provider.name}`, { type: 'success' })
    } catch {
      toast('Failed to sign out', { type: 'error' })
    } finally {
      setConfirmOpen(false)
    }
  }

  return (
    <>
      <tr>
        <td>{provider.name}</td>
        <td>
          <span className={`pill ${provider.logged_in ? 'pill-ok' : 'pill-warn'}`}>
            {provider.logged_in ? 'logged in' : 'not connected'}
          </span>
        </td>
        <td style={{ fontFamily: 'var(--m-font-mono)', fontSize: 11 }}>
          {provider.token_preview ?? '—'}
        </td>
        <td style={{ fontSize: 11 }}>
          {provider.expires_at ? new Date(provider.expires_at).toLocaleDateString() : '—'}
        </td>
        <td>
          {provider.logged_in && (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmOpen(true)}>
              Sign out
            </button>
          )}
        </td>
      </tr>

      <ConfirmDialog
        open={confirmOpen}
        title={`Sign out of ${provider.name}`}
        message={`This will revoke your ${provider.name} OAuth token. You will need to re-authenticate to use this provider.`}
        confirmLabel="Sign out"
        destructive
        onConfirm={() => void handleSignOut()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}

// ── SectionApiKeys ────────────────────────────────────────────────

export default function SectionApiKeys() {
  const { data: envVars, isLoading: envLoading } = useQuery({
    queryKey: ['env'],
    queryFn: getEnv,
    staleTime: 30_000,
  })

  const { data: oauthProviders, isLoading: oauthLoading } = useQuery({
    queryKey: ['oauth-providers'],
    queryFn: listOAuthProviders,
    staleTime: 30_000,
  })

  const passwordEntries = envVars
    ? Object.entries(envVars).filter(([, info]) => info.is_password === true)
    : []

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>API Keys</h2>
          <div className="desc">Manage environment credentials and OAuth provider connections.</div>
        </div>
        <div className="meta">Section · <b>api-keys</b></div>
      </div>

      <SettingCard title="Environment variables">
        {envLoading && (
          <div style={{ padding: '12px 18px', color: 'var(--m-text-faint)', fontSize: 12 }}>Loading…</div>
        )}
        {!envLoading && passwordEntries.length === 0 && (
          <div style={{ padding: '12px 18px', color: 'var(--m-text-faint)', fontSize: 12 }}>No password-type variables found.</div>
        )}
        {passwordEntries.map(([key, info]) => (
          <EnvRow key={key} envKey={key} info={info} />
        ))}
      </SettingCard>

      <SettingCard title="OAuth providers">
        {oauthLoading && (
          <div style={{ padding: '12px 18px', color: 'var(--m-text-faint)', fontSize: 12 }}>Loading…</div>
        )}
        {!oauthLoading && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--m-text-faint)', textAlign: 'left' }}>
                  <th style={{ padding: '6px 12px' }}>Provider</th>
                  <th style={{ padding: '6px 12px' }}>Status</th>
                  <th style={{ padding: '6px 12px' }}>Token</th>
                  <th style={{ padding: '6px 12px' }}>Expires</th>
                  <th style={{ padding: '6px 12px' }}></th>
                </tr>
              </thead>
              <tbody>
                {(oauthProviders ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: '12px', color: 'var(--m-text-faint)' }}>No OAuth providers configured.</td>
                  </tr>
                ) : (
                  (oauthProviders ?? []).map((p) => (
                    <OAuthRow key={p.id} provider={p} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </SettingCard>

      <SettingCard title="Local tokens">
        <SettingRow label="Rotate local tokens" desc="Generate new local authentication tokens">
          <button
            type="button"
            className="btn"
            onClick={() => toast('Token rotation is not yet available', { type: 'info' })}
          >
            Rotate tokens
          </button>
        </SettingRow>
      </SettingCard>
    </div>
  )
}
