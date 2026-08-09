/**
 * trust-boundaries.ts — an honest answer to "is this connected", in three
 * parts instead of one.
 *
 * The old system-check step rendered ten rows, all of them derived from a
 * single `/api/gateway-status` probe, and none of them able to tell a user
 * *which* hop was broken. There are three, they fail independently, and two of
 * them fail in ways that look exactly like the third:
 *
 *   1. **browser → UI.** Is this workspace password-protected, and is this
 *      browser authenticated to it? Everything else is unknowable from behind
 *      a login screen.
 *   2. **UI → gateway.** A 401 from the gateway's `/health` means our bearer
 *      token does not match its `API_SERVER_KEY`. The gateway is *running*.
 *      Reporting that as "the gateway is not responding" — which the previous
 *      check did, because it only looked at a boolean — sends the user to
 *      restart a process that was never down. `gateway.authError` exists
 *      precisely to separate the two, and this module is its consumer.
 *   3. **gateway → provider.** Whether the credential the gateway will resolve
 *      actually exists, and in which store. `/api/credentials` answers with
 *      provenance rather than a boolean, and it has an explicit "could not
 *      read" state. Unreachable must never render as unconfigured: that is the
 *      failure mode that tells a user to paste a key they already have.
 *
 * Pure and total. Every input may be `null` — a probe that has not landed is
 * `'unknown'`, never `'fail'`, the same rule `system-checks.ts` has always
 * applied.
 */

export type BoundaryStatus = 'ok' | 'warn' | 'fail' | 'unknown'

export type BoundaryHeal =
  | 'start-agent'
  | 'restart-gateway'
  | 'change-url'
  | 'reprobe'
  | null

export type TrustBoundaryId = 'browser-ui' | 'ui-gateway' | 'gateway-provider'

export type TrustBoundary = {
  id: TrustBoundaryId
  label: string
  status: BoundaryStatus
  detail: string
  /**
   * The sentence that stops a status being misread. A 401 is the canonical
   * case: the verdict is "blocked", and without this line the user reads it as
   * "down" and restarts a healthy process.
   */
  note?: string
  heal: BoundaryHeal
}

export type AuthCheckPayload = {
  authenticated?: boolean
  authRequired?: boolean
} | null

export type GatewayStatusPayload = {
  capabilities?: {
    health?: boolean
    chatCompletions?: boolean
    models?: boolean
    authError?: boolean
  }
  gateway?: { available?: boolean; authError?: boolean; url?: string }
  dashboard?: { available?: boolean }
  claudeUrl?: string
  scope?: { mode?: string; servingProfile?: string | null }
} | null

export type CredentialsPayload = {
  ok?: boolean
  degraded?: boolean
  unreachable?: Array<string>
  statuses?: Array<{
    key?: string
    provider?: string
    origin?: string
    effectiveOrigin?: string
    shadowedBy?: string
    detail?: string
  }>
} | null

export type TrustBoundaryInput = {
  auth: AuthCheckPayload
  gateway: GatewayStatusPayload
  credentials: CredentialsPayload
  /** Agent version string from `/api/agent-version`, when it answered. */
  agentVersion: string | null
  /** The provider `config.yaml` currently names as active, if any. */
  activeProvider: string | null
}

/** Human names for the credential origins `/api/credentials` reports. */
const ORIGIN_PROSE: Record<string, string> = {
  'inline-config': 'inline in config.yaml',
  'env-file': 'the .env file',
  'env-shell': "the gateway process's shell environment",
  oauth: 'the gateway OAuth store',
  pool: 'the auth.json credential pool',
  vault: 'an external secret source',
  none: 'nowhere',
  unknown: 'a store that could not be read',
}

function originProse(origin: string | undefined): string {
  return origin ? (ORIGIN_PROSE[origin] ?? origin) : 'an unnamed store'
}

function browserToUi(auth: AuthCheckPayload): TrustBoundary {
  if (!auth) {
    return {
      id: 'browser-ui',
      label: 'Browser → Switch UI',
      status: 'unknown',
      detail: 'The workspace has not answered its own auth check yet.',
      heal: 'reprobe',
    }
  }
  if (auth.authRequired === true) {
    return auth.authenticated === true
      ? {
          id: 'browser-ui',
          label: 'Browser → Switch UI',
          status: 'ok',
          detail:
            'This workspace requires a password and this browser is signed in.',
          heal: null,
        }
      : {
          id: 'browser-ui',
          label: 'Browser → Switch UI',
          status: 'fail',
          detail:
            'This workspace requires a password and this browser is not signed in.',
          heal: null,
        }
  }
  return {
    id: 'browser-ui',
    label: 'Browser → Switch UI',
    status: 'warn',
    detail:
      'No password is set, so anyone who can reach this address can use it.',
    note: 'That is the right default on localhost. Set HERMES_PASSWORD before binding to 0.0.0.0.',
    heal: null,
  }
}

function uiToGateway(
  gateway: GatewayStatusPayload,
  agentVersion: string | null,
): TrustBoundary {
  const label = 'Switch UI → Hermes gateway'
  if (!gateway) {
    return {
      id: 'ui-gateway',
      label,
      status: 'unknown',
      detail: 'The gateway has not been probed yet.',
      heal: 'reprobe',
    }
  }

  const url = gateway.gateway?.url || gateway.claudeUrl || ''
  const where = url ? ` at ${url}` : ''
  const authError =
    gateway.gateway?.authError === true ||
    gateway.capabilities?.authError === true

  // A 401 is the whole reason this module exists. The gateway answered — with
  // a refusal. Restarting it changes nothing.
  if (authError) {
    return {
      id: 'ui-gateway',
      label,
      status: 'fail',
      detail: `The gateway${where} answered with 401 Unauthorized.`,
      note:
        'The gateway is running. This is a token mismatch, not an outage: the workspace’s ' +
        'HERMES_API_TOKEN does not match the gateway’s API_SERVER_KEY. Restarting will not fix it.',
      heal: 'change-url',
    }
  }

  const reachable =
    gateway.gateway?.available === true ||
    gateway.capabilities?.health === true ||
    gateway.capabilities?.chatCompletions === true

  if (reachable) {
    const version = agentVersion ? ` Running hermes-agent ${agentVersion}.` : ''
    const serving = gateway.scope?.servingProfile
    const profile = serving ? ` Serving profile “${serving}”.` : ''
    return {
      id: 'ui-gateway',
      label,
      status: 'ok',
      detail: `Reachable${where}.${version}${profile}`,
      note: agentVersion
        ? undefined
        : 'The agent version could not be read from the dashboard.',
      heal: null,
    }
  }

  if (
    gateway.capabilities?.health === false ||
    gateway.gateway?.available === false
  ) {
    return {
      id: 'ui-gateway',
      label,
      status: 'fail',
      detail: `Nothing answered${where}.`,
      note: 'Either the agent is not running, or the URL points somewhere else.',
      heal: 'start-agent',
    }
  }

  return {
    id: 'ui-gateway',
    label,
    status: 'unknown',
    detail:
      'The gateway probe returned a shape this workspace does not recognise.',
    heal: 'reprobe',
  }
}

function gatewayToProvider(
  credentials: CredentialsPayload,
  activeProvider: string | null,
): TrustBoundary {
  const label = 'Hermes gateway → model provider'

  // "We could not look" is never "not configured". This branch comes first so
  // a degraded report can never be downgraded into a missing-credential claim.
  if (!credentials || credentials.degraded === true) {
    const blocked = credentials?.unreachable ?? []
    return {
      id: 'gateway-provider',
      label,
      status: 'unknown',
      detail: blocked.length
        ? `Could not read ${blocked.join(', ')}.`
        : 'Credential provenance has not been read yet.',
      note:
        'This is not the same as “no credential”. A key may well be configured — the store ' +
        'holding it just could not be read from here.',
      heal: 'reprobe',
    }
  }

  if (!activeProvider) {
    return {
      id: 'gateway-provider',
      label,
      status: 'warn',
      detail: 'No provider is active in config.yaml yet.',
      heal: null,
    }
  }

  const rows = credentials.statuses ?? []
  const row = rows.find((entry) => entry.provider === activeProvider)

  if (!row) {
    return {
      id: 'gateway-provider',
      label,
      status: 'unknown',
      detail: `${activeProvider} is active, but no credential row was reported for it.`,
      note:
        'Some providers need no credential at all (a local Ollama, for instance). The first ' +
        'chat is what settles it.',
      heal: null,
    }
  }

  const effective = row.effectiveOrigin ?? row.origin
  if (effective === 'none') {
    return {
      id: 'gateway-provider',
      label,
      status: 'fail',
      detail: `${activeProvider} has no credential in any store this workspace can read.`,
      heal: null,
    }
  }
  if (effective === 'unknown') {
    return {
      id: 'gateway-provider',
      label,
      status: 'unknown',
      detail:
        row.detail ??
        `Could not determine where ${activeProvider}’s credential lives.`,
      heal: 'reprobe',
    }
  }
  if (row.shadowedBy) {
    return {
      id: 'gateway-provider',
      label,
      status: 'warn',
      detail:
        `${activeProvider} resolves its credential from ${originProse(row.shadowedBy)}, ` +
        `not from ${originProse(row.origin)}.`,
      note:
        row.detail ??
        'Two copies exist and the higher-precedence one wins — editing the other has no effect.',
      heal: null,
    }
  }

  return {
    id: 'gateway-provider',
    label,
    status: 'ok',
    detail: `${activeProvider} resolves its credential from ${originProse(effective)}.`,
    note: 'Resolving is not the same as working. The first chat proves the rest.',
    heal: null,
  }
}

export function buildTrustBoundaries(
  input: TrustBoundaryInput,
): Array<TrustBoundary> {
  return [
    browserToUi(input.auth),
    uiToGateway(input.gateway, input.agentVersion),
    gatewayToProvider(input.credentials, input.activeProvider),
  ]
}

/**
 * Whether the Connect step is satisfied. Only the UI → gateway hop can block:
 * the browser hop is settled by the fact that this screen rendered at all, and
 * the provider hop is what step 2 is for.
 */
export function connectSatisfied(boundaries: Array<TrustBoundary>): boolean {
  const hop = boundaries.find((entry) => entry.id === 'ui-gateway')
  return hop?.status === 'ok'
}
