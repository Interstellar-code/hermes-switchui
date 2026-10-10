/**
 * section-gateway.tsx — Gateway topology & API-server settings.
 *
 * Real DEFAULT_CONFIG keys:
 *   gateway.multiplex_profiles     — default False (gateway/config.py:880).
 *     The switch the whole Profiles feature depends on; today it is
 *     mentioned only in error copy elsewhere in the app. Requires a gateway
 *     RESTART to take effect (read once at process start).
 *   platforms.api_server.extra.host — default 127.0.0.1 (gateway/platforms/api_server.py:1287)
 *   platforms.api_server.extra.port — default 8642 (gateway/platforms/api_server.py:1289-1291)
 *     The agent reads host/port ONLY under `extra` (env `API_SERVER_HOST|PORT`
 *     otherwise). The older flat keys `platforms.api_server.host|port` are
 *     ignored by the agent but still shown as a read-side fallback for
 *     configs saved by older UIs; writes always target the `extra` keys.
 *
 * Live topology (read-only, from GET /api/gateway-status → `scope`) is shown
 * alongside the config values so a mismatch between "what's configured" and
 * "what's actually running" (pre-restart) is visible instead of silent.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { Toggle } from '../components/controls'
import type { ReactNode } from 'react'
import type { ScopeStatusResponse } from '@/screens/chat/components/chat-composer-types'
import { useSettingsStore } from '@/stores/settings-store'
import { fetchScopeStatus } from '@/screens/chat/components/chat-composer-services'
import { PROFILE_SCOPE_STATUS_KEY } from '@/hooks/use-profile-scope-status'
import { HermesDocsLink } from '@/components/hermes-docs-link'

// `/api/gateway-status`'s `scope` payload actually carries `mode: 'unknown'`
// and `servingProfile` at runtime (gateway-status.ts), which predate
// `ScopeStatusResponse`'s narrower `mode: 'single' | 'multiplex'` type — see
// `use-profile-scope-status.ts`'s identical note. Read the wire shape here
// directly rather than through that hook, which deliberately drops
// `servingProfile` when called without a profile name.
type GatewayScopeStatus = Omit<ScopeStatusResponse, 'mode'> & {
  mode: 'single' | 'multiplex' | 'unknown'
  servingProfile?: string | null
}

function WarningNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="note"
      style={{
        display: 'flex',
        gap: '8px',
        padding: '10px 12px',
        margin: '0 0 12px',
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
      <span>{children}</span>
    </div>
  )
}

function InfoNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        gap: '8px',
        padding: '10px 12px',
        margin: '0 0 12px',
        borderRadius: '6px',
        border: '1px solid var(--m-border, var(--theme-border))',
        background:
          'color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 6%, transparent)',
        fontSize: '12px',
        color: 'var(--m-text-faint, var(--theme-muted))',
        lineHeight: 1.4,
      }}
    >
      <span aria-hidden style={{ flexShrink: 0 }}>
        ⓘ
      </span>
      <span>{children}</span>
    </div>
  )
}

/** IPv4 literal, IPv6 literal (bare, no brackets needed for a config value),
 *  `localhost`, or a DNS-hostname-shaped string. Loose on purpose — this is a
 *  sanity check to catch typos (stray spaces, protocol prefixes, ports typed
 *  into the host field), not a strict RFC validator. */
export function validateApiServerHost(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return 'Host is required.'
  if (/\s/.test(trimmed)) return 'Host cannot contain spaces.'
  if (/^[a-z]+:\/\//i.test(trimmed)) {
    return 'Enter a bare host (no "http://"), e.g. 127.0.0.1 or 0.0.0.0.'
  }
  if (
    trimmed.includes(':') &&
    !trimmed.includes('::') &&
    /:\d+$/.test(trimmed)
  ) {
    return 'Do not include a port here — use the Port field below.'
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
  const ipv4Match = trimmed.match(ipv4)
  if (ipv4Match) {
    const bad = ipv4Match.slice(1).some((octet) => Number(octet) > 255)
    if (bad) return `"${trimmed}" is not a valid IPv4 address.`
    return null
  }
  const hostnamePattern =
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,62})?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,62})?)*$/
  if (
    trimmed === 'localhost' ||
    trimmed === '::' ||
    trimmed === '::1' ||
    hostnamePattern.test(trimmed)
  ) {
    return null
  }
  return `"${trimmed}" does not look like a valid host or IP address.`
}

export function validateApiServerPort(value: number): string | null {
  if (!Number.isFinite(value) || !Number.isInteger(value))
    return 'Port must be a whole number.'
  if (value < 1 || value > 65535) return 'Port must be between 1 and 65535.'
  if (value < 1024) {
    return `Port ${value} is a privileged (<1024) port — binding it usually requires root and will fail otherwise.`
  }
  return null
}

/** Where the agent actually reads host/port from — and the only keys we write. */
const EXTRA_HOST_KEY = 'config.platforms.api_server.extra.host'
const EXTRA_PORT_KEY = 'config.platforms.api_server.extra.port'
/** Pre-`extra` flat keys: ignored by the agent, shown only as a read fallback. */
const LEGACY_HOST_KEY = 'config.platforms.api_server.host'
const LEGACY_PORT_KEY = 'config.platforms.api_server.port'

export default function SectionGateway() {
  const draft = useSettingsStore((s) => s.draft)
  const set = useSettingsStore((s) => s.set)
  const [portInput, setPortInput] = useState<string | null>(null)

  const multiplexProfiles =
    (draft['config.gateway.multiplex_profiles'] as boolean | undefined) ?? false
  // Display: `extra` wins; an absent `extra` key falls back to the legacy flat
  // key so configs written by older UIs still display (and can be re-saved to
  // `extra`). The agent ignores the legacy keys entirely.
  const extraHost = draft[EXTRA_HOST_KEY] as string | undefined
  const legacyHost = draft[LEGACY_HOST_KEY] as string | undefined
  const apiHost = extraHost ?? legacyHost ?? '127.0.0.1'
  const extraPortRaw = draft[EXTRA_PORT_KEY] as number | string | undefined
  const legacyPortRaw = draft[LEGACY_PORT_KEY] as number | string | undefined
  const displayedPortRaw = extraPortRaw ?? legacyPortRaw
  const apiPort =
    displayedPortRaw === undefined || displayedPortRaw === ''
      ? 8642
      : Number(displayedPortRaw)
  const hostIsLegacy = extraHost === undefined && legacyHost !== undefined
  const portIsLegacy = extraPortRaw === undefined && legacyPortRaw !== undefined

  // Effective: the address the agent actually binds — `extra`, else env /
  // default. The legacy flat keys never apply, so they must not drive the
  // non-default warning either.
  const effectiveHost = extraHost ?? '127.0.0.1'
  const effectivePort =
    extraPortRaw === undefined || extraPortRaw === ''
      ? 8642
      : Number(extraPortRaw)

  const hostError = validateApiServerHost(apiHost)
  const portError = validateApiServerPort(apiPort)
  // SwitchUI's own gateway connection (HERMES_API_URL) assumes the default
  // loopback address; anything else needs the env var updated to match.
  const nonDefaultAddress =
    effectiveHost !== '127.0.0.1' || effectivePort !== 8642

  // Shares the composer's query key on purpose — React Query dedupes by key,
  // so this is an extra observer on one poll, not a second HTTP request.
  const scopeQuery = useQuery({
    queryKey: PROFILE_SCOPE_STATUS_KEY,
    queryFn: fetchScopeStatus,
    staleTime: 5_000,
    retry: false,
  })
  const scopeData: GatewayScopeStatus | undefined = scopeQuery.data
  const liveMode = scopeData?.mode ?? null // 'single' | 'multiplex' | 'unknown' | null
  const servingProfile =
    liveMode === 'single' ? (scopeData?.servingProfile ?? null) : null

  const configVsLiveMismatch =
    liveMode !== null &&
    liveMode !== 'unknown' &&
    ((multiplexProfiles && liveMode === 'single') ||
      (!multiplexProfiles && liveMode === 'multiplex'))

  function commitHost(value: string) {
    set(EXTRA_HOST_KEY, value)
    // Materialize the legacy-sourced port displayed next to this edit, so
    // what is shown after saving is what the agent applies.
    if (portIsLegacy) set(EXTRA_PORT_KEY, apiPort)
  }

  function handlePortChange(text: string) {
    setPortInput(text)
    const parsed = Number(text)
    if (text.trim() !== '' && Number.isFinite(parsed)) {
      set(EXTRA_PORT_KEY, Math.trunc(parsed))
      // Symmetric: materialize the legacy-sourced host the UI is showing.
      if (hostIsLegacy) set(EXTRA_HOST_KEY, apiHost)
    }
  }

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Gateway</h2>
          <div className="desc">
            Multi-profile topology and the OpenAI-compatible API server.
          </div>
        </div>
        <div className="meta">
          Section · <b>gateway · platforms.api_server</b>
        </div>
      </div>

      <SettingCard title="Profile multiplexing">
        <InfoNote>
          When ON, one gateway process serves multiple profiles at once, each
          addressed by a URL prefix (<code>/p/&lt;profile&gt;/</code>). When OFF
          (default), each profile needs its own gateway process. This is the
          flag the entire Profiles feature depends on — with it off, only the
          launch profile's config is ever consulted, and other profiles'
          settings (including terminal.cwd) are silently ignored. Requires
          restarting the gateway to take effect; it is read once at process
          start.{' '}
          <HermesDocsLink
            path="user-guide/multi-profile-gateways.md"
            label="Docs"
          />
        </InfoNote>
        <SettingRow
          label="Multiplex profiles"
          pill={{ t: 'restart required' }}
          desc="gateway.multiplex_profiles — one gateway serving several profiles by URL prefix."
        >
          <Toggle
            on={multiplexProfiles}
            set={(v) => set('config.gateway.multiplex_profiles', v)}
          />
        </SettingRow>

        <SettingRow
          label="Live topology"
          desc="What the running gateway is actually doing right now, independent of this setting."
        >
          <span
            style={{
              fontSize: '12px',
              fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
              color: 'var(--m-text-faint, var(--theme-muted))',
            }}
          >
            {liveMode === null || liveMode === 'unknown'
              ? 'unknown'
              : liveMode === 'multiplex'
                ? 'multiplex'
                : `single${servingProfile ? ` (serving "${servingProfile}")` : ''}`}
          </span>
        </SettingRow>
        {configVsLiveMismatch && (
          <WarningNote>
            The saved setting (multiplex {multiplexProfiles ? 'on' : 'off'})
            does not match what the live gateway is doing (reporting {liveMode}
            ). The gateway only re-reads this at startup — restart it for the
            setting to take effect, or this control is describing a future
            state, not the current one.
          </WarningNote>
        )}
      </SettingCard>

      <SettingCard title="API server (platforms.api_server)">
        <WarningNote>
          A wrong host or port here means nothing can connect to the API server,
          usually with no diagnostic beyond a connection refused/timeout.
          Double-check before saving.
        </WarningNote>
        {nonDefaultAddress && (
          <WarningNote>
            The effective API server address (
            <code>
              {effectiveHost}:{effectivePort}
            </code>
            ) differs from the default <code>127.0.0.1:8642</code> that
            SwitchUI's gateway connection (<code>HERMES_API_URL</code>) expects
            — update SwitchUI's environment to match, or the UI will not reach
            the agent.
          </WarningNote>
        )}
        <SettingRow
          label="Host"
          pill={
            hostError
              ? { t: 'invalid' }
              : hostIsLegacy
                ? { t: 'legacy' }
                : undefined
          }
          desc={
            hostError ??
            (hostIsLegacy
              ? 'Legacy value, not applied by the agent — editing saves it under platforms.api_server.extra.host.'
              : 'Interface the API server binds to. 127.0.0.1 = local only, 0.0.0.0 = all interfaces.')
          }
        >
          <input
            type="text"
            className="text-input"
            value={apiHost}
            placeholder="127.0.0.1"
            onChange={(e) => commitHost(e.target.value)}
          />
        </SettingRow>
        <SettingRow
          label="Port"
          pill={
            portError
              ? { t: 'invalid' }
              : portIsLegacy
                ? { t: 'legacy' }
                : undefined
          }
          desc={
            portError ??
            (portIsLegacy
              ? 'Legacy value, not applied by the agent — editing saves it under platforms.api_server.extra.port.'
              : 'TCP port the API server listens on.')
          }
        >
          <input
            type="number"
            className="text-input"
            min={1}
            max={65535}
            value={portInput ?? String(apiPort)}
            placeholder="8642"
            onChange={(e) => handlePortChange(e.target.value)}
          />
        </SettingRow>
      </SettingCard>
    </div>
  )
}
