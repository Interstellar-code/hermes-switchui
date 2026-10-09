/** null = upstream failed; the UI shows an empty state for that slice. */
export type Slice<T> = T | null

/** Something that waits on the operator. */
export type NeedsYouItem =
  | {
      kind: 'approval'
      runId: string
      nodeRunId: string
      workflow: string
      version: string
      pausedAt: string
      progress: string
      next: string
      agent: string
      at: string
    }
  | {
      kind: 'cron-failing'
      jobId: string
      name: string
      failures: number
      lastError: string
      agent: string
      at: string
    }
  | {
      kind: 'task-review'
      taskId: string
      title: string
      board: string
      agent: string
      at: string
    }

export interface DashboardSocial {
  /** Selected profile; null = all profiles. */
  profile: string | null
  /** ISO timestamp of when the server built this payload. */
  generatedAt: string
  /** The operator's level card: XP, level bounds, streak, active days Mon..Sun. */
  operator: Slice<{
    name: string
    xp: number
    level: number
    levelStartXp: number
    nextLevelXp: number
    streakDays: number
    bestStreak: number
    activeDays: Array<boolean>
  }>
  /** One entry per agent profile, with this week's activity. */
  agents: Slice<
    Array<{
      id: string
      initials: string
      sessions: number
      tokensWeek: number
      tasksWeek: number
      runsWeek: number
      working: boolean
      topTools: Array<string>
    }>
  >
  /** Hot topics this week (max 5). */
  hotTopics: Slice<Array<{ label: string; href: string }>>
  /** Counts behind the shortcut rings. */
  counts: Slice<{
    chats: number
    needsYou: number
    workflows: number
    cron: number
    tasks: number
    memory: number
    selfImprove: number
    gatewayOk: boolean
  }>
  /** Items waiting on the operator. */
  needsYou: Slice<Array<NeedsYouItem>>
  /** Latest activity feed (max 5). */
  recent: Slice<
    Array<{
      at: string
      kind: 'chat' | 'workflow' | 'cron' | 'task' | 'memory' | 'badge'
      title: string
      sub: string
      who: string
      href: string
    }>
  >
  /** Badge progress; earned iff have >= need. */
  badges: Slice<
    Array<{
      id: string
      name: string
      how: string
      have: number
      need: number
      earnedAt: string | null
    }>
  >
}

export type DashboardAgent = NonNullable<DashboardSocial['agents']>[number]
export type DashboardBadge = NonNullable<DashboardSocial['badges']>[number]
export type RecentItem = NonNullable<DashboardSocial['recent']>[number]
export type DashboardCounts = NonNullable<DashboardSocial['counts']>
export type OperatorStats = NonNullable<DashboardSocial['operator']>
