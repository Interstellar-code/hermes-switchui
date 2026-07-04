export type SessionOrchestrationMeta = {
  title: string | null
  badgeLabel: string | null
  detail: string | null
}

type SessionKind = string | null | undefined

function normalize(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function getSessionOrchestrationMeta(
  sessionKey: string | null | undefined,
  kind?: SessionKind,
): SessionOrchestrationMeta {
  const key = normalize(sessionKey)
  const normalizedKind = normalize(kind)

  if (normalizedKind === 'subagent' || normalizedKind === 'sub-agent' || key.includes(':subagent:')) {
    return {
      title: 'Subagent Worker',
      badgeLabel: 'Subagent',
      detail: 'Delegated worker · inherits parent session context',
    }
  }

  if (normalizedKind === 'main' || key === 'agent:main:main') {
    return {
      title: 'Main Agent',
      badgeLabel: 'Main',
      detail: 'Primary orchestration session',
    }
  }

  if (normalizedKind === 'cron' || key.includes(':cron:')) {
    return {
      title: 'Cron Task',
      badgeLabel: 'Cron',
      detail: 'Scheduled automation session',
    }
  }

  return {
    title: null,
    badgeLabel: null,
    detail: null,
  }
}

export function getSessionKindBadgeLabel(kind: SessionKind): string {
  const meta = getSessionOrchestrationMeta('', kind)
  if (meta.badgeLabel) return meta.badgeLabel

  const normalizedKind = normalize(kind)
  if (normalizedKind === 'chat') return 'Chat'
  if (!normalizedKind) return 'Session'
  return normalizedKind.charAt(0).toUpperCase() + normalizedKind.slice(1)
}
