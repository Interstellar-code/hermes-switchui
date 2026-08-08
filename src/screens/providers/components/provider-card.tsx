'use client'

import { providerInitials } from '../icons'
import type { ProviderStatus, ProviderView } from '../lib/provider-view'
import { ProviderLogo, hasProviderLogo } from '@/components/provider-logo'

/** Stripe colour per status — the fastest read on a wall of cards. */
const STATUS_ACCENT: Record<ProviderStatus, string> = {
  active: 'var(--m-green-500, var(--theme-accent))',
  ready: 'var(--m-green-300, var(--theme-accent-secondary))',
  'needs-key': 'var(--m-warning, #d6ff5f)',
  offline: 'var(--m-text-faint, var(--theme-muted))',
  available: 'var(--m-info, #5fcfff)',
}

const STATUS_LABEL: Record<ProviderStatus, string> = {
  active: 'Active',
  ready: 'Ready',
  'needs-key': 'Needs key',
  offline: 'Offline',
  available: 'Available',
}

export function ProviderStatusPill({ status }: { status: ProviderStatus }) {
  return (
    <span className={`pv-status-pill pv-${status}`}>
      <span className="pv-d" />
      {STATUS_LABEL[status]}
    </span>
  )
}

export function ProviderGlyph({ view }: { view: ProviderView }) {
  return (
    <span className="pv-glyph" aria-hidden>
      {hasProviderLogo(view.id) ? (
        <ProviderLogo provider={view.id} size={28} />
      ) : (
        providerInitials(view.name)
      )}
    </span>
  )
}

export function ProviderCard({
  view,
  onOpen,
}: {
  view: ProviderView
  onOpen: (view: ProviderView) => void
}) {
  const modelsLabel = view.modelsUnknown ? 'unknown' : String(view.modelCount)

  return (
    <article
      className={`pv-card${view.status === 'available' ? ' pv-available' : ''}`}
      style={
        { '--card-accent': STATUS_ACCENT[view.status] } as React.CSSProperties
      }
      role="button"
      tabIndex={0}
      aria-label={view.name}
      onClick={() => onOpen(view)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(view)
        }
      }}
    >
      <div className="pv-hd">
        <ProviderGlyph view={view} />
        <div style={{ minWidth: 0 }}>
          <div className="pv-name">{view.name}</div>
          <div className="pv-by">{view.id}</div>
        </div>
        <div className="pv-right">
          <ProviderStatusPill status={view.status} />
        </div>
      </div>

      <p className="pv-desc">{view.description}</p>

      {view.baseUrl ? <div className="pv-endpoint">{view.baseUrl}</div> : null}

      <div className="pv-kvgrid">
        <div className="pv-kv">
          <span className="pv-lbl">Models</span>
          <span className="pv-val">{modelsLabel}</span>
        </div>
        <div className="pv-kv">
          <span className="pv-lbl">Credential</span>
          <span className="pv-val">
            {view.authSource === 'env'
              ? (view.envKey ?? '.env')
              : view.authSource === 'config-inline'
                ? 'config.yaml'
                : view.authSource === 'claude-auth-store'
                  ? 'auth store'
                  : view.authKind === 'local'
                    ? 'not needed'
                    : '—'}
          </span>
        </div>
      </div>

      <div className="pv-ft">
        <span className="pv-tag pv-auth">{view.authKind}</span>
        {/* A local runtime's authKind is already "local" — don't say it twice. */}
        {view.origin === 'local' && view.authKind !== 'local' ? (
          <span className="pv-tag pv-local">local</span>
        ) : null}
        {view.modelsUnknown ? (
          // The gateway reports only its synthetic `auto` entry for this
          // provider, so we know it is configured but not what it can run.
          <span className="pv-tag">models unknown</span>
        ) : null}
      </div>
    </article>
  )
}
