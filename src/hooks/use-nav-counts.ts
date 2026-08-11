/**
 * use-nav-counts.ts — lightweight item counts for the primary nav badges.
 *
 * Each section count is an isolated useQuery so they cache independently and
 * fail independently (a down endpoint hides only its own badge). Gated on
 * `enabled` (passed as !collapsed) so nothing fetches while the nav is collapsed
 * — badges are hidden in that state anyway. Counts revalidate when the window
 * regains focus once stale, so returning to the app does not leave old badges.
 *
 * On error the query throws → data is undefined → the badge is hidden, matching
 * how the boards badge already behaves. A successful empty list shows "0".
 */

import { useQuery } from '@tanstack/react-query'
import { fetchJobs } from '@/lib/jobs-api'
import { commandsKeys, fetchUserCommands } from '@/lib/commands-api'
import { fetchStats } from '@/lib/tasks-api'
import { fetchTemplates } from '@/lib/board-templates-api'
import { getPluginsHub } from '@/lib/hermes-client'
import { useResolvedProfile } from '@/hooks/use-resolved-profile'
import { scopeSegments } from '@/lib/session-scope'

/**
 * Nav-count query keys — the single construction point so every badge count
 * carries the resolved profile. `scopeSegments` is `[]` when unscoped, so an
 * app with no profile selected produces byte-identical keys to before.
 *
 * `commands` and `plugins-hub` are deliberately absent: those queries share a
 * cache key with `commands-api.ts`'s `commandsKeys` and
 * `plugins-screen.tsx`/`section-mcp-registered.tsx`'s `['plugins-hub']`
 * respectively — files outside this task's scope. Forking the key here would
 * split that shared cache. Both backing endpoints (`/api/commands`,
 * `/api/dashboard/plugins/hub`) are also verified profile-agnostic today (no
 * `profile` handling server-side), so leaving them unscoped is not a known
 * staleness bug — see task report.
 */
export const navCountKeys = {
  tasks: (profile: string | null) => ['nav-count', 'tasks', ...scopeSegments(profile)],
  templates: (profile: string | null) => ['nav-count', 'templates', ...scopeSegments(profile)],
  jobs: (profile: string | null) => ['nav-count', 'jobs', ...scopeSegments(profile)],
  sessions: (profile: string | null) => ['nav-count', 'sessions', ...scopeSegments(profile)],
  workflows: (profile: string | null) => ['nav-count', 'workflows', ...scopeSegments(profile)],
  skills: (profile: string | null) => ['nav-count', 'skills', ...scopeSegments(profile)],
  mcp: (profile: string | null) => ['nav-count', 'mcp', ...scopeSegments(profile)],
  profiles: (profile: string | null) => ['nav-count', 'profiles', ...scopeSegments(profile)],
}

/** Append `?profile=` (or `&profile=`) when a profile is resolved. No-op when unscoped. */
function withProfileParam(url: string, profile: string | null): string {
  if (!profile) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}profile=${encodeURIComponent(profile)}`
}

/** Fetch `url` and return its authoritative total, falling back to array length. */
export async function countFromArray(
  url: string,
  key: string,
  totalKey?: string,
): Promise<number> {
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (totalKey && typeof data[totalKey] === 'number') return data[totalKey]
  const arr = data[key]
  return Array.isArray(arr) ? arr.length : 0
}

export interface NavCounts {
  tasks?: number
  templates?: number
  jobs?: number
  chat?: number
  workflows?: number
  commands?: number
  skills?: number
  mcp?: number
  profiles?: number
  plugins?: number
}

export function useNavCounts(enabled: boolean): NavCounts {
  const profile = useResolvedProfile()
  const common = {
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  } as const

  // Tasks = number of tasks in the current board (sum of by_status counts).
  const tasks = useQuery({
    queryKey: navCountKeys.tasks(profile),
    queryFn: async () => {
      const stats = await fetchStats()
      return Object.values(stats.by_status ?? {}).reduce(
        (sum, n) => sum + (typeof n === 'number' ? n : 0),
        0,
      )
    },
    ...common,
  })
  const templates = useQuery({
    queryKey: navCountKeys.templates(profile),
    queryFn: async () => (await fetchTemplates()).templates.length,
    ...common,
  })
  const jobs = useQuery({
    queryKey: navCountKeys.jobs(profile),
    queryFn: async () => (await fetchJobs()).length,
    ...common,
  })
  // /api/sessions supports ?profile= — thread it through so a profile switch
  // both re-keys the cache AND fetches that profile's own session count.
  const chat = useQuery({
    queryKey: navCountKeys.sessions(profile),
    queryFn: () => countFromArray(withProfileParam('/api/sessions', profile), 'sessions'),
    ...common,
  })
  const workflows = useQuery({
    queryKey: navCountKeys.workflows(profile),
    queryFn: () => countFromArray('/api/workflow-definitions', 'definitions'),
    ...common,
  })
  // Share the same cache the commands screen invalidates via `commandsKeys`.
  // TanStack Query dedupes by queryKey, so this is a free subscription — the
  // badge updates the instant a command is created/edited/deleted, with no
  // staleTime gap. `select` keeps the hook as a pure projection (length).
  // NOT profile-scoped: /api/commands has no profile awareness server-side
  // (global command store), and commands-api.ts is owned by another task —
  // see the note on `navCountKeys` above.
  const commands = useQuery({
    queryKey: commandsKeys.list(),
    queryFn: fetchUserCommands,
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    select: (data) => data.length,
  })
  // /api/skills supports ?profile= — thread it through the same way.
  const skills = useQuery({
    queryKey: navCountKeys.skills(profile),
    queryFn: () =>
      countFromArray(
        withProfileParam('/api/skills?tab=installed&limit=200', profile),
        'skills',
        'total',
      ),
    ...common,
  })
  const mcp = useQuery({
    queryKey: navCountKeys.mcp(profile),
    queryFn: () => countFromArray('/api/mcp', 'servers'),
    ...common,
  })
  const profiles = useQuery({
    queryKey: navCountKeys.profiles(profile),
    queryFn: () => countFromArray('/api/profiles/list', 'profiles'),
    ...common,
  })
  // NOT profile-scoped: shares ['plugins-hub'] with plugins-screen.tsx /
  // section-mcp-registered.tsx (both out of scope), and the backing
  // /api/dashboard/plugins/hub route has no profile awareness — see the note
  // on `navCountKeys` above.
  const plugins = useQuery({
    queryKey: ['plugins-hub'],
    queryFn: getPluginsHub,
    ...common,
    select: (hub) => hub.plugins.length,
  })

  return {
    tasks: tasks.data,
    templates: templates.data,
    jobs: jobs.data,
    chat: chat.data,
    workflows: workflows.data,
    commands: commands.data,
    skills: skills.data,
    mcp: mcp.data,
    profiles: profiles.data,
    plugins: plugins.data,
  }
}
