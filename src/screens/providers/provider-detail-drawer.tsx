'use client'

/**
 * provider-detail-drawer.tsx — right-anchored detail panel.
 *
 * Rendered as an inline sibling of the shell rather than through a portal, so
 * it inherits the screen's `data-screen` scope and its styles come from the
 * same stylesheet. Mechanics mirror mcp-detail-drawer.tsx: one nullable state
 * value drives it, Escape closes, and the panel stays mounted (empty) so the
 * open/close transition has something to animate.
 */
import { useEffect, useState } from 'react'
import { ProviderGlyph, ProviderStatusPill } from './components/provider-card'
import { Ico } from './icons'
import type { ProviderView } from './lib/provider-view'
import { useEnvVarRow } from '@/hooks/use-env-var-row'
import { ConfirmDialog } from '@/screens/profiles/components/confirm-dialog'

type DrawerTab = 'overview' | 'models' | 'credentials' | 'config'

type Props = {
  provider: ProviderView | null
  busy?: boolean
  onClose: () => void
  onEdit: (provider: ProviderView) => void
  onDelete: (provider: ProviderView) => void
  onSetActive: (provider: ProviderView) => void
}

const AUTH_SOURCE_LABEL: Record<ProviderView['authSource'], string> = {
  env: '.env',
  'config-inline': 'config.yaml (inline)',
  'claude-auth-store': 'auth store',
  none: 'none found',
}

function CredentialsTab({ provider }: { provider: ProviderView }) {
  const envKey = provider.envKey ?? ''
  const row = useEnvVarRow(envKey)
  const [confirmOpen, setConfirmOpen] = useState(false)

  if (provider.authKind === 'local') {
    return (
      <div className="pv-panel-card">
        <h4>Credential</h4>
        <p>
          Local runtimes authenticate by being reachable — there is no key to
          manage.
        </p>
      </div>
    )
  }

  if (provider.authSource === 'config-inline') {
    return (
      <div className="pv-panel-card">
        <h4>Credential</h4>
        <p>
          This provider&apos;s key is stored inline in{' '}
          <code>~/.hermes/config.yaml</code> as <code>model.api_key</code>, not
          in <code>.env</code>. Edit it through the provider form so the value
          stays in the shape the gateway reads.
        </p>
      </div>
    )
  }

  if (!envKey) {
    return (
      <div className="pv-panel-card">
        <h4>Credential</h4>
        <p>
          No environment variable is associated with this provider yet. Add one
          through Edit.
        </p>
      </div>
    )
  }

  return (
    <div className="pv-panel-card">
      <h4>Credential</h4>
      <div className="pv-cred-row">
        <span className="pv-keyname">{envKey}</span>
        <span
          className={`pv-status-pill pv-${provider.configured ? 'ready' : 'needs-key'}`}
        >
          <span className="pv-d" />
          {provider.configured ? 'set' : 'missing'}
        </span>
      </div>

      {row.editing ? (
        <div className="pv-cred-row">
          <input
            type="password"
            aria-label={`New value for ${envKey}`}
            value={row.editValue}
            placeholder="New value"
            onChange={(event) => row.setEditValue(event.target.value)}
            style={{ flex: 1, minWidth: 180 }}
          />
          <button
            type="button"
            className="pv-btn pv-btn-primary pv-btn-sm"
            disabled={row.busy}
            onClick={() => void row.saveEdit()}
          >
            Save
          </button>
          <button
            type="button"
            className="pv-btn pv-btn-sm"
            onClick={row.cancelEdit}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="pv-cred-row">
          <span className="pv-secret">
            {row.revealedValue ?? provider.maskedKey ?? '••••••••'}
          </span>
          <span className="pv-spacer" />
          {provider.configured ? (
            <button
              type="button"
              className="pv-btn pv-btn-sm"
              onClick={() => void row.toggleReveal()}
            >
              {row.isRevealed ? 'Hide' : 'Reveal'}
            </button>
          ) : null}
          <button
            type="button"
            className="pv-btn pv-btn-sm"
            onClick={row.startEdit}
          >
            {provider.configured ? 'Replace' : 'Set key'}
          </button>
          {provider.configured ? (
            <button
              type="button"
              className="pv-btn pv-btn-danger pv-btn-sm"
              onClick={() => setConfirmOpen(true)}
            >
              Delete
            </button>
          ) : null}
        </div>
      )}

      {row.isRevealed ? (
        <p>Hiding again in 30 seconds.</p>
      ) : (
        <p>Stored in ~/.hermes/.env</p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`Delete ${envKey}?`}
        message="The provider stays configured but will not be able to authenticate until you set a new key."
        confirmLabel="Delete key"
        destructive
        onConfirm={() => {
          void row.remove().then(() => setConfirmOpen(false))
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}

export function ProviderDetailDrawer({
  provider,
  busy,
  onClose,
  onEdit,
  onDelete,
  onSetActive,
}: Props) {
  const [tab, setTab] = useState<DrawerTab>('overview')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && provider) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [provider, onClose])

  useEffect(() => {
    if (provider) setTab('overview')
  }, [provider?.id])

  if (!provider) {
    return (
      <>
        <div className="pv-drawer-scrim" />
        <aside className="pv-drawer" aria-hidden />
      </>
    )
  }

  return (
    <>
      <div className="pv-drawer-scrim open" onClick={onClose} />
      <aside
        className="pv-drawer open"
        role="dialog"
        aria-label={`${provider.name} details`}
      >
        <div className="pv-drawer-hdr">
          <ProviderGlyph view={provider} />
          <div style={{ minWidth: 0 }}>
            <h2>{provider.name}</h2>
            <div className="pv-meta-line">
              <span>{provider.id}</span>
              <span>{provider.authKind}</span>
              <span>{provider.origin}</span>
            </div>
          </div>
          <div className="pv-hdr-actions">
            <ProviderStatusPill status={provider.status} />
            <button
              type="button"
              className="pv-ico-btn"
              onClick={onClose}
              aria-label="Close details"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="pv-drawer-tabs">
          <button
            type="button"
            className={tab === 'overview' ? 'on' : undefined}
            onClick={() => setTab('overview')}
          >
            Overview
          </button>
          <button
            type="button"
            className={tab === 'models' ? 'on' : undefined}
            onClick={() => setTab('models')}
          >
            Models
            <span className="pv-ct">
              {provider.modelsUnknown ? '?' : provider.modelCount}
            </span>
          </button>
          <button
            type="button"
            className={tab === 'credentials' ? 'on' : undefined}
            onClick={() => setTab('credentials')}
          >
            Credentials
          </button>
          <button
            type="button"
            className={tab === 'config' ? 'on' : undefined}
            onClick={() => setTab('config')}
          >
            Config
          </button>
        </div>

        <div className="pv-drawer-body">
          {tab === 'overview' ? (
            <>
              <div className="pv-stat-grid">
                <div className="pv-stat-card">
                  <span className="pv-lbl">Status</span>
                  <span className="pv-val">{provider.status}</span>
                </div>
                <div className="pv-stat-card">
                  <span className="pv-lbl">Models</span>
                  <span className="pv-val">
                    {provider.modelsUnknown ? 'unknown' : provider.modelCount}
                  </span>
                </div>
                <div className="pv-stat-card">
                  <span className="pv-lbl">Credential</span>
                  <span className="pv-val">
                    {AUTH_SOURCE_LABEL[provider.authSource]}
                  </span>
                </div>
                <div className="pv-stat-card">
                  <span className="pv-lbl">Defined in</span>
                  <span className="pv-val">
                    {provider.configShape === 'providers-map'
                      ? 'providers:'
                      : provider.configShape === 'inline-model'
                        ? 'model:'
                        : 'not added'}
                  </span>
                </div>
              </div>

              <div className="pv-panel-card">
                <h4>About</h4>
                <p>{provider.description}</p>
                {provider.baseUrl ? (
                  <div className="pv-endpoint">{provider.baseUrl}</div>
                ) : null}
                {provider.docsUrl ? (
                  <a
                    className="pv-btn pv-btn-sm"
                    href={provider.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ justifySelf: 'start' }}
                  >
                    Documentation ↗
                  </a>
                ) : null}
              </div>

              {provider.modelsUnknown ? (
                <div className="pv-note pv-warn">
                  The gateway reports no model list for this provider — usually
                  it has not been restarted since the provider was added.
                </div>
              ) : null}
            </>
          ) : null}

          {tab === 'models' ? (
            provider.models.length > 0 ? (
              <div className="pv-model-list">
                {provider.models.map((model) => (
                  <div className="pv-model-row" key={model.id}>
                    <span>{model.id}</span>
                    {model.contextLength ? (
                      <span className="pv-ctx">
                        {Math.round(model.contextLength / 1000)}k ctx
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="pv-panel-card">
                <h4>Models</h4>
                <p>
                  {provider.modelsUnknown
                    ? 'The gateway exposes no model list for this provider yet. Restart it to refresh.'
                    : 'No models reported for this provider.'}
                </p>
              </div>
            )
          ) : null}

          {tab === 'credentials' ? (
            <CredentialsTab provider={provider} />
          ) : null}

          {tab === 'config' ? (
            <div className="pv-panel-card">
              <h4>config.yaml</h4>
              <pre className="pv-diff">
                {provider.configShape === 'inline-model'
                  ? [
                      'model:',
                      `  provider: ${provider.id}`,
                      provider.baseUrl
                        ? `  base_url: ${provider.baseUrl}`
                        : null,
                      provider.activeModel
                        ? `  default: ${provider.activeModel}`
                        : null,
                      provider.configured ? '  api_key: ********' : null,
                    ]
                      .filter(Boolean)
                      .join('\n')
                  : provider.inConfig
                    ? [
                        'providers:',
                        `  ${provider.id}:`,
                        provider.type ? `    type: ${provider.type}` : null,
                        provider.baseUrl
                          ? `    base_url: ${provider.baseUrl}`
                          : null,
                        provider.keyEnv
                          ? `    key_env: ${provider.keyEnv}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join('\n')
                    : `# ${provider.id} is not in config.yaml yet`}
              </pre>
            </div>
          ) : null}
        </div>

        <div className="pv-drawer-foot">
          {!provider.isActive && provider.inConfig ? (
            <button
              type="button"
              className="pv-btn"
              disabled={busy}
              onClick={() => onSetActive(provider)}
            >
              {Ico.bolt} Set as active
            </button>
          ) : null}
          <span className="pv-grow" />
          <button
            type="button"
            className="pv-btn pv-btn-primary"
            onClick={() => onEdit(provider)}
          >
            {provider.inConfig ? 'Edit' : 'Add provider'}
          </button>
          {provider.inConfig ? (
            <button
              type="button"
              className="pv-btn pv-btn-danger"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              {Ico.trash} Remove
            </button>
          ) : null}
        </div>
      </aside>

      {/* Removing the provider deliberately leaves its credential alone —
          deleting a secret is its own explicit action on the Credentials tab,
          not a side effect hidden behind a checkbox. */}
      <ConfirmDialog
        open={confirmDelete}
        title={`Remove ${provider.name}?`}
        message={
          provider.envKey && provider.authSource === 'env'
            ? `Removes the provider from config.yaml. ${provider.envKey} stays in .env — delete it separately from the Credentials tab if you want it gone.`
            : 'Removes the provider from config.yaml.'
        }
        confirmLabel="Remove provider"
        destructive
        onConfirm={() => {
          onDelete(provider)
          setConfirmDelete(false)
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  )
}
