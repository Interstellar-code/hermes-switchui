import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  explicitProjectProfile,
  listProjects,
} from '../../../server/projects-client'
import { isValidProfileName } from '../../../lib/profile-name'
import { gitStatusOf } from '../../../server/project-git-status'
import type { GitStatus } from '../../../server/project-git-status'
import { runPool } from '@/lib/run-pool'

export const Route = createFileRoute('/api/hermes-projects/git-status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const profile = explicitProjectProfile(request)
        if (profile && !isValidProfileName(profile)) {
          return Response.json({ error: 'Invalid profile' }, { status: 400 })
        }
        try {
          // Paths come only from the profile's own project list, never the request.
          const { projects } = await listProjects(true, profile)
          const dirsOf = new Map(
            projects.map((project) => [
              project.id,
              project.folders
                .map((folder) => folder.path)
                .filter((p) => typeof p === 'string' && path.isAbsolute(p)),
            ]),
          )
          const allDirs = [...new Set([...dirsOf.values()].flat())]
          // At most 4 dirs probed at once: each probe holds an fs thread.
          const settled = await runPool(allDirs, 4, (dir) => gitStatusOf(dir))
          const statusOf = new Map(
            allDirs.map((dir, i) => {
              const r = settled[i]
              return [
                dir,
                r.status === 'fulfilled'
                  ? r.value
                  : ({ git: false, unknown: true } as const),
              ]
            }),
          )
          const result: Record<string, GitStatus> = {}
          for (const [id, dirs] of dirsOf) {
            if (dirs.length === 0) continue
            // Folders come primary-first: the first repo found names the branch.
            const statuses = dirs.map((dir) => statusOf.get(dir)!)
            result[id] = statuses.find((s) => s.git) ??
              statuses.find((s) => s.unknown) ?? { git: false }
          }
          return Response.json(result)
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : 'Dashboard unavailable'
          return Response.json({ error: msg }, { status: 503 })
        }
      },
    },
  },
})
