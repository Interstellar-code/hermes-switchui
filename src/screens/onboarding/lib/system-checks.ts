/**
 * system-checks.ts — turns the raw responses of four endpoints
 * (`/api/gateway-status`, `/api/system-metrics`, `/api/agent-version`,
 * `/api/update/status`) into a flat list the system-check step can render.
 *
 * Every input is `unknown` on purpose: this runs against whatever the
 * network handed back, which on a bad day is `null`, an empty object, or a
 * 401/404 error body with none of the expected fields. The one rule that
 * matters more than any individual check: `'fail'` means "we got a real
 * answer and it says broken". Anything short of that — no data, a shape we
 * do not recognize, a field that is simply absent — degrades to
 * `'unknown'`, never `'fail'`, so this never reports a false outage just
 * because a probe hasn't completed yet.
 */
export type CheckStatus = 'ok' | 'warn' | 'fail' | 'unknown'

export type SystemCheck = {
  id: string
  label: string
  status: CheckStatus
  detail: string
  /** Inline remediation the UI can offer. */
  heal: 'start-agent' | 'restart-gateway' | 'change-url' | 'reprobe' | null
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function boolField(
  rec: Record<string, unknown> | null,
  key: string,
): boolean | undefined {
  const value = rec?.[key]
  return typeof value === 'boolean' ? value : undefined
}

function numField(
  rec: Record<string, unknown> | null,
  key: string,
): number | undefined {
  const value = rec?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function strField(
  rec: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = rec?.[key]
  return typeof value === 'string' && value ? value : undefined
}

const UNKNOWN_DETAIL =
  "Couldn't determine — no data was reported for this check."

function boolCheck(
  id: string,
  label: string,
  value: boolean | undefined,
  okDetail: string,
  failDetail: string,
  heal: SystemCheck['heal'],
): SystemCheck {
  if (value === true)
    return { id, label, status: 'ok', detail: okDetail, heal: null }
  if (value === false) {
    return { id, label, status: 'fail', detail: failDetail, heal }
  }
  return {
    id,
    label,
    status: 'unknown',
    detail: UNKNOWN_DETAIL,
    heal: 'reprobe',
  }
}

/**
 * Resource usage is never a `'fail'` on its own — a busy machine is not "the
 * check found something broken", just something worth flagging past a
 * threshold.
 */
function percentCheck(
  id: string,
  label: string,
  percent: number | undefined,
  noun: string,
): SystemCheck {
  if (percent === undefined) {
    return {
      id,
      label,
      status: 'unknown',
      detail: `Couldn't determine ${noun.toLowerCase()} usage.`,
      heal: 'reprobe',
    }
  }
  if (percent >= 90) {
    return {
      id,
      label,
      status: 'warn',
      detail: `${noun} usage is high at ${percent}%.`,
      heal: null,
    }
  }
  return {
    id,
    label,
    status: 'ok',
    detail: `${noun} usage is ${percent}%.`,
    heal: null,
  }
}

const CAPABILITY_FLAGS = [
  'sessions',
  'skills',
  'memory',
  'config',
  'jobs',
  'mcp',
]

function capabilitySummaryCheck(
  capabilities: Record<string, unknown> | null,
): SystemCheck {
  if (!capabilities) {
    return {
      id: 'capabilities',
      label: 'Capability summary',
      status: 'unknown',
      detail: "Couldn't determine — the gateway has not been probed yet.",
      heal: 'reprobe',
    }
  }
  const on = CAPABILITY_FLAGS.filter((flag) => capabilities[flag] === true)
  return {
    id: 'capabilities',
    label: 'Capability summary',
    status: 'ok',
    detail:
      `${on.length} of ${CAPABILITY_FLAGS.length} enhanced capabilities are on` +
      (on.length ? `: ${on.join(', ')}.` : '.'),
    heal: null,
  }
}

function agentVersionCheck(agentVersion: unknown): SystemCheck {
  const version = strField(record(agentVersion), 'version')
  if (version) {
    return {
      id: 'agent-version',
      label: 'Agent version',
      status: 'ok',
      detail: `Running hermes-agent ${version}.`,
      heal: null,
    }
  }
  return {
    id: 'agent-version',
    label: 'Agent version',
    status: 'unknown',
    detail: "Couldn't determine the agent version.",
    heal: 'reprobe',
  }
}

function updateCheck(update: unknown): SystemCheck {
  const rec = record(update)
  const ok = boolField(rec, 'ok')
  const updateAvailable = boolField(rec, 'updateAvailable')
  if (rec && ok !== false && updateAvailable !== undefined) {
    return updateAvailable
      ? {
          id: 'update-available',
          label: 'Update available',
          status: 'warn',
          detail: 'A newer version is available.',
          heal: null,
        }
      : {
          id: 'update-available',
          label: 'Update available',
          status: 'ok',
          detail: 'You are on the latest version.',
          heal: null,
        }
  }
  return {
    id: 'update-available',
    label: 'Update available',
    status: 'unknown',
    detail: "Couldn't determine — the update check did not respond.",
    heal: 'reprobe',
  }
}

export function buildSystemChecks(input: {
  gateway?: unknown | null
  metrics?: unknown | null
  agentVersion?: unknown | null
  update?: unknown | null
}): Array<SystemCheck> {
  const capabilities = record(record(input.gateway)?.capabilities)
  const metrics = record(input.metrics)
  const cpu = record(metrics?.cpu)
  const memory = record(metrics?.memory)
  const disk = record(metrics?.disk)
  const hermes = record(metrics?.hermes)

  return [
    boolCheck(
      'gateway',
      'Gateway reachable',
      boolField(capabilities, 'health'),
      'The gateway responded to a health check.',
      'The gateway did not respond to a health check.',
      'start-agent',
    ),
    boolCheck(
      'chat-completions',
      'Chat completions',
      boolField(capabilities, 'chatCompletions'),
      'The chat completions endpoint is available.',
      'The chat completions endpoint is not available.',
      'restart-gateway',
    ),
    boolCheck(
      'models',
      'Models endpoint',
      boolField(capabilities, 'models'),
      'The models endpoint is available.',
      'The models endpoint is not available.',
      'restart-gateway',
    ),
    boolCheck(
      'dashboard',
      'Dashboard available',
      boolField(hermes, 'dashboard'),
      'The Hermes dashboard is reachable.',
      'The Hermes dashboard is not reachable.',
      'restart-gateway',
    ),
    capabilitySummaryCheck(capabilities),
    percentCheck('cpu', 'CPU load', numField(cpu, 'loadPercent'), 'CPU'),
    percentCheck('memory', 'Memory', numField(memory, 'usedPercent'), 'Memory'),
    percentCheck('disk', 'Disk', numField(disk, 'usedPercent'), 'Disk'),
    agentVersionCheck(input.agentVersion),
    updateCheck(input.update),
  ]
}
