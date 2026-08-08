/**
 * section-api-keys.tsx — API Keys & OAuth section.
 *
 * Correctly wired to real endpoints:
 *   GET/PUT/DELETE /api/env        — environment credentials
 *   POST /api/env/reveal           — reveal masked value
 *   GET /api/providers/oauth       — OAuth provider list
 *   DELETE /api/providers/oauth/:id — revoke OAuth token
 *
 * Added: summary card with env-var count + "Open Keys →" nav to /settings/providers.
 * Trimmed: standalone "Local tokens" card (no rotate endpoint exists).
 */

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { PasswordField } from '../components/controls'
import type { EnvVarInfo, OAuthProvider } from '@/lib/hermes-client'
import {
  deleteEnv,
  deleteOAuth,
  getEnv,
  listOAuthProviders,
  putEnv,
  revealEnv,
} from '@/lib/hermes-client'
import { ConfirmDialog } from '@/screens/profiles/components/confirm-dialog'
import { humanizeEnvKey, useEnvVarRow } from '@/hooks/use-env-var-row'
import { toast } from '@/components/ui/toast'

// ── Helpers ───────────────────────────────────────────────────────

// ── EnvRow ────────────────────────────────────────────────────────

function EnvRow({ envKey, info }: { envKey: string; info: EnvVarInfo }) {
  // Reveal/edit/delete behaviour is shared with the providers drawer — see
  // src/hooks/use-env-var-row.ts. Only the markup lives here.
  const row = useEnvVarRow(envKey)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  const displayValue = row.revealedValue || info.redacted_value || ''
  const label = info.description ? info.description : humanizeEnvKey(envKey)

  return (
    <>
      <SettingRow
        label={label}
        desc={envKey}
        pill={info.is_set ? { t: 'set' } : { t: 'missing' }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
          {row.editing ? (
            <>
              <PasswordField
                value={row.editValue}
                masked={false}
                onChange={row.setEditValue}
                placeholder="Enter new value"
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={row.busy}
                onClick={() => void row.saveEdit()}
              >
                Save
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={row.cancelEdit}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <PasswordField
                value={displayValue}
                masked={!row.isRevealed}
                onChange={() => undefined}
                disabled
              />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void row.toggleReveal()}
              >
                {row.isRevealed ? 'Hide' : 'Reveal'}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={row.startEdit}
              >
                Edit
              </button>
              {info.is_set && (
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() => setConfirmDeleteOpen(true)}
                >
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      </SettingRow>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete environment variable"
        message={`Remove ${humanizeEnvKey(envKey)}? This may break features that depend on it.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          void row.remove().then(() => setConfirmDeleteOpen(false))
        }}
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
          <span
            className={`pill ${provider.logged_in ? 'pill-ok' : 'pill-warn'}`}
          >
            {provider.logged_in ? 'logged in' : 'not connected'}
          </span>
        </td>
        <td style={{ fontFamily: 'var(--m-font-mono)', fontSize: 11 }}>
          {provider.token_preview ?? '—'}
        </td>
        <td style={{ fontSize: 11 }}>
          {provider.expires_at
            ? new Date(provider.expires_at).toLocaleDateString()
            : '—'}
        </td>
        <td>
          {provider.logged_in && (
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => setConfirmOpen(true)}
            >
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
  const navigate = useNavigate()

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

  const setCount = passwordEntries.filter(([, info]) => info.is_set).length
  const totalCount = passwordEntries.length
  const oauthConnected = (oauthProviders ?? []).filter(
    (p) => p.logged_in,
  ).length

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>API Keys</h2>
          <div className="desc">
            Manage environment credentials and OAuth provider connections.
          </div>
        </div>
        <div className="meta">
          Section · <b>api-keys</b>
        </div>
      </div>

      {/* Summary card */}
      <SettingCard title="Keys overview">
        <div
          style={{
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div
            className="kv"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              fontSize: '12px',
              fontFamily: 'var(--m-font-mono)',
              color: 'var(--m-text-faint)',
            }}
          >
            <div>
              <span style={{ color: 'var(--m-text-dim, var(--m-text-faint))' }}>
                Env keys
              </span>
              {' · '}
              <b style={{ color: 'var(--m-text)' }}>
                {setCount}/{totalCount} set
              </b>
            </div>
            <div>
              <span style={{ color: 'var(--m-text-dim, var(--m-text-faint))' }}>
                OAuth
              </span>
              {' · '}
              <b style={{ color: 'var(--m-text)' }}>
                {oauthConnected} connected
              </b>
            </div>
          </div>
          <button
            className="btn"
            style={{ fontSize: '11px', padding: '4px 10px' }}
            onClick={() => void navigate({ to: '/settings/providers' })}
          >
            Open Providers →
          </button>
        </div>
      </SettingCard>

      <SettingCard title="Environment variables">
        {envLoading && (
          <div
            style={{
              padding: '12px 18px',
              color: 'var(--m-text-faint)',
              fontSize: 12,
            }}
          >
            Loading…
          </div>
        )}
        {!envLoading && passwordEntries.length === 0 && (
          <div
            style={{
              padding: '12px 18px',
              color: 'var(--m-text-faint)',
              fontSize: 12,
            }}
          >
            No password-type variables found.
          </div>
        )}
        {passwordEntries.map(([key, info]) => (
          <EnvRow key={key} envKey={key} info={info} />
        ))}
      </SettingCard>

      <SettingCard title="OAuth providers">
        {oauthLoading && (
          <div
            style={{
              padding: '12px 18px',
              color: 'var(--m-text-faint)',
              fontSize: 12,
            }}
          >
            Loading…
          </div>
        )}
        {!oauthLoading && (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                fontSize: 12,
                borderCollapse: 'collapse',
              }}
            >
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
                    <td
                      colSpan={5}
                      style={{ padding: '12px', color: 'var(--m-text-faint)' }}
                    >
                      No OAuth providers configured.
                    </td>
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
    </div>
  )
}
