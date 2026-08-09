/**
 * section-api-keys.tsx — API Keys & OAuth section.
 *
 * Correctly wired to real endpoints:
 *   GET/PUT/DELETE /api/env        — environment credentials
 *   POST /api/env/reveal           — reveal masked value
 *   GET /api/providers/oauth       — OAuth provider list
 *   DELETE /api/providers/oauth/:id — revoke OAuth token
 *   GET /api/credentials           — provenance + precedence per credential
 *
 * The row status used to be `is_set ? 'set' : 'missing'`. That boolean was
 * wrong in three separate ways, all of them invisible to the user:
 *
 *  - a key present in `.env` can be beaten by an inline `api_key` in
 *    config.yaml or a `credential_pool` entry in auth.json, so "set" did not
 *    mean "used";
 *  - a key exported in the shell reads as "missing" here (the dashboard
 *    reports the `.env` file), and under `gateway.multiplex_profiles` it
 *    really IS unusable — but for the opposite reason to the one shown;
 *  - when the dashboard is unreachable, EVERY key rendered as "missing",
 *    which invites the user to re-paste credentials they already have.
 *
 * So the pill is now an origin chip, a shadowing warning is a first-class
 * line, and "unknown" is a state we can display.
 */

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { PasswordField } from '../components/controls'
import type { EnvVarInfo, OAuthProvider } from '@/lib/hermes-client'
import type {
  CredentialOrigin,
  CredentialStatus,
} from '@/server/credential-status'
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

// ── Credential provenance ─────────────────────────────────────────

type CredentialReport = {
  ok?: boolean
  scope?: string
  multiplex?: boolean
  statuses?: Array<CredentialStatus>
  unreachable?: Array<string>
  degraded?: boolean
}

async function getCredentialReport(): Promise<CredentialReport> {
  const res = await fetch('/api/credentials')
  if (!res.ok) throw new Error(`/api/credentials failed (${res.status})`)
  return (await res.json()) as CredentialReport
}

/**
 * Short labels for the chip. Deliberately the words a user would use when
 * describing where they put the key, not the internal enum.
 */
const ORIGIN_CHIP: Record<CredentialOrigin, string> = {
  'inline-config': 'inline',
  'env-file': '.env',
  'env-shell': 'shell',
  oauth: 'OAuth',
  pool: 'pool',
  vault: 'vault',
  none: 'none',
  unknown: 'unknown',
}

const ORIGIN_TITLE: Record<CredentialOrigin, string> = {
  'inline-config': 'Stored as a literal api_key in ~/.hermes/config.yaml.',
  'env-file': 'Stored in the .env file the gateway reads.',
  'env-shell':
    'Exported in the shell that started the gateway — not in any .env file.',
  oauth: 'An OAuth grant in ~/.hermes/auth.json.',
  pool: 'A credential-pool entry in ~/.hermes/auth.json.',
  vault: 'Supplied by an external secret source.',
  none: 'Not present in any store we could read.',
  unknown:
    'At least one credential store could not be read. This is NOT the same as "not set" — the key may well be there.',
}

/** Colour by meaning: resolves cleanly / resolves but is shadowed / neither. */
function chipStyle(status: CredentialStatus): React.CSSProperties {
  const tone =
    status.origin === 'unknown'
      ? 'var(--m-text-faint)'
      : status.origin === 'none'
        ? 'var(--m-text-faint)'
        : status.shadowedBy
          ? 'var(--m-warn, #d08c00)'
          : 'var(--m-ok, var(--m-accent))'
  return {
    fontFamily: 'var(--m-font-mono)',
    fontSize: 10,
    textTransform: 'lowercase',
    border: `1px solid ${tone}`,
    color: tone,
    borderRadius: 3,
    padding: '0 5px',
    marginLeft: 6,
    whiteSpace: 'nowrap',
  }
}

function OriginChip({ status }: { status: CredentialStatus }) {
  return (
    <span style={chipStyle(status)} title={ORIGIN_TITLE[status.origin]}>
      {ORIGIN_CHIP[status.origin]}
      {status.shadowedBy ? ` → ${ORIGIN_CHIP[status.shadowedBy]}` : ''}
    </span>
  )
}

type Verification = { ok: boolean; at: number; detail?: string }

function verificationLabel(verified: Verification | undefined): string {
  if (!verified) return 'not verified this session'
  const when = new Date(verified.at).toLocaleTimeString()
  return verified.ok
    ? `verified at ${when}`
    : `rejected at ${when}${verified.detail ? ` — ${verified.detail}` : ''}`
}

// ── EnvRow ────────────────────────────────────────────────────────

function EnvRow({
  envKey,
  info,
  status,
}: {
  envKey: string
  info: EnvVarInfo
  status?: CredentialStatus
}) {
  // Reveal/edit/delete behaviour is shared with the providers drawer — see
  // src/hooks/use-env-var-row.ts. Only the markup lives here.
  const row = useEnvVarRow(envKey)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [verified, setVerified] = useState<Verification | undefined>(undefined)

  const displayValue = row.revealedValue || info.redacted_value || ''
  const label = info.description ? info.description : humanizeEnvKey(envKey)

  /**
   * Probe the live value against the provider. Needs the real value, so it
   * reveals first — the reveal endpoint is rate-limited and audit-logged by
   * the gateway, which is why this is a button rather than something the page
   * does to every row on load.
   */
  async function verifyNow() {
    try {
      const value = row.revealedValue ?? (await revealEnv(envKey)).value
      const res = await fetch('/api/dashboard-proxy/api/providers/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: envKey, value }),
      })
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        reachable?: boolean
        message?: string
      }
      if (payload.reachable === false) {
        // No probe registered, or we are offline. Saying "invalid" here would
        // be a lie, and users act on it by deleting a working key.
        setVerified({
          ok: false,
          at: Date.now(),
          detail:
            payload.message || 'could not reach the provider — result unknown',
        })
        return
      }
      setVerified({
        ok: payload.ok === true,
        at: Date.now(),
        detail: payload.message || undefined,
      })
    } catch (error) {
      setVerified({
        ok: false,
        at: Date.now(),
        detail: error instanceof Error ? error.message : 'verification failed',
      })
    }
  }

  return (
    <>
      <SettingRow
        label={label}
        desc={envKey}
        pill={
          status ? undefined : info.is_set ? { t: 'set' } : { t: 'missing' }
        }
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            flex: 1,
            alignItems: 'stretch',
          }}
        >
          <div
            style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}
          >
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
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void verifyNow()}
                  title="Reveal this key and probe it against the provider."
                >
                  Verify
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

          {/* Provenance line. `origin` says where the value the UI edits
              lives; `shadowedBy` says which OTHER copy the gateway will use
              instead — the case a boolean could never express. */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontFamily: 'var(--m-font-mono)',
              color: 'var(--m-text-faint)',
            }}
          >
            <span>source</span>
            {status ? (
              <OriginChip status={status} />
            ) : (
              <span style={{ marginLeft: 6 }}>—</span>
            )}
            <span>· {verificationLabel(verified)}</span>
          </div>

          {status?.shadowedBy ? (
            <div
              style={{
                fontSize: 11,
                color: 'var(--m-warn, #d08c00)',
                lineHeight: 1.5,
              }}
            >
              Also set in {ORIGIN_CHIP[status.shadowedBy]}, which wins — editing
              this one will not change what the gateway sends.
            </div>
          ) : null}

          {status?.origin === 'unknown' ? (
            <div
              style={{
                fontSize: 11,
                color: 'var(--m-text-faint)',
                lineHeight: 1.5,
              }}
            >
              {status.detail ??
                'A credential store could not be read, so this may be set. Not the same as missing.'}
            </div>
          ) : null}

          {status?.detail &&
          status.origin !== 'unknown' &&
          !status.shadowedBy ? (
            <div
              style={{
                fontSize: 11,
                color: 'var(--m-text-faint)',
                lineHeight: 1.5,
              }}
            >
              {status.detail}
            </div>
          ) : null}
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

  // Provenance is a separate, best-effort query: it enriches the rows but must
  // never gate them, and a failure here is itself reported (as `unknown`)
  // rather than silently downgrading every row to "missing".
  const { data: report } = useQuery({
    queryKey: ['credential-status'],
    queryFn: getCredentialReport,
    staleTime: 30_000,
    retry: false,
  })

  const statusByKey = new Map<string, CredentialStatus>(
    (report?.statuses ?? []).map((status) => [status.key, status]),
  )

  const passwordEntries = envVars
    ? Object.entries(envVars).filter(([, info]) => info.is_password === true)
    : []

  const setCount = passwordEntries.filter(([, info]) => info.is_set).length
  const totalCount = passwordEntries.length
  const oauthConnected = (oauthProviders ?? []).filter(
    (p) => p.logged_in,
  ).length
  const shadowedCount = (report?.statuses ?? []).filter(
    (status) => status.shadowedBy,
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
            {shadowedCount > 0 ? (
              <div style={{ color: 'var(--m-warn, #d08c00)' }}>
                {shadowedCount} key{shadowedCount === 1 ? ' has' : 's have'} a
                higher-precedence copy elsewhere
              </div>
            ) : null}
            {report?.multiplex ? (
              <div>
                gateway is multiplexing profiles · env vars resolve only from{' '}
                {report.scope === 'root' ? 'the profile' : report.scope}
                &rsquo;s .env
              </div>
            ) : null}
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
        {report?.degraded ? (
          <div
            style={{
              padding: '10px 18px',
              fontSize: 11,
              lineHeight: 1.6,
              color: 'var(--m-warn, #d08c00)',
              fontFamily: 'var(--m-font-mono)',
            }}
          >
            Could not read every credential store (
            {report.unreachable?.join(', ')}). Rows below may show{' '}
            <b>unknown</b> — that means &ldquo;we could not look&rdquo;, not
            &ldquo;not set&rdquo;. Do not re-paste a key on the strength of it.
          </div>
        ) : null}
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
          <EnvRow
            key={key}
            envKey={key}
            info={info}
            status={statusByKey.get(key)}
          />
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
