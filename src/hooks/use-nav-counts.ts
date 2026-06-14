/**
 * use-nav-counts.ts — lightweight item counts for the primary nav badges.
 *
 * Each section count is an isolated useQuery so they cache independently and
 * fail independently (a down endpoint hides only its own badge). Gated on
 * `enabled` (passed as !collapsed) so nothing fetches while the nav is collapsed
 * — badges are hidden in that state anyway.
 *
 * On error the query throws → data is undefined → the badge is hidden, matching
 * how the boards badge already behaves. A successful empty list shows "0".
 */

import { useQuery } from '@tanstack/react-query'
import { fetchJobs } from '@/lib/jobs-api'
import { fetchUserCommands } from '@/lib/commands-api'
import { fetchStats } from '@/lib/tasks-api'
import { fetchTemplates } from '@/lib/board-templates-api'

/** Fetch `url` and return the length of the array under `key`. Throws on HTTP error. */
async function countFromArray(url: string, key: string): Promise<number> {
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
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
}

export function useNavCounts(enabled: boolean): NavCounts {
  const common = { enabled, staleTime: 60_000, refetchOnWindowFocus: false } as const

  // Tasks = number of tasks in the current board (sum of by_status counts).
  const tasks = useQuery({
    queryKey: ['nav-count', 'tasks'],
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
    queryKey: ['nav-count', 'templates'],
    queryFn: async () => (await fetchTemplates()).templates.length,
    ...common,
  })
  const jobs = useQuery({
    queryKey: ['nav-count', 'jobs'],
    queryFn: async () => (await fetchJobs()).length,
    ...common,
  })
  const chat = useQuery({
    queryKey: ['nav-count', 'sessions'],
    queryFn: () => countFromArray('/api/sessions', 'sessions'),
    ...common,
  })
  const workflows = useQuery({
    queryKey: ['nav-count', 'workflows'],
    queryFn: () => countFromArray('/api/workflow-definitions', 'definitions'),
    ...common,
  })
  const commands = useQuery({
    queryKey: ['nav-count', 'commands'],
    queryFn: async () => (await fetchUserCommands()).length,
    ...common,
  })
  const skills = useQuery({
    queryKey: ['nav-count', 'skills'],
    queryFn: () => countFromArray('/api/skills?tab=installed&limit=200', 'skills'),
    ...common,
  })
  const mcp = useQuery({
    queryKey: ['nav-count', 'mcp'],
    queryFn: () => countFromArray('/api/mcp', 'servers'),
    ...common,
  })
  const profiles = useQuery({
    queryKey: ['nav-count', 'profiles'],
    queryFn: () => countFromArray('/api/profiles/list', 'profiles'),
    ...common,
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
  }
}
