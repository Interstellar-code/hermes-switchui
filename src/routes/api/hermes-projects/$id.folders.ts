import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import {
  addProjectFolder,
  explicitProjectProfile,
  getProjectFolders,
  projectsErrorStatus,
  removeProjectFolder,
} from '../../../server/projects-client'
import type { AddProjectFolderInput } from '@/lib/projects-types'

export const Route = createFileRoute('/api/hermes-projects/$id/folders')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const result = await getProjectFolders(params.id, explicitProjectProfile(request))
          return Response.json(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Not found'
          return Response.json(
            { error: msg },
            { status: projectsErrorStatus(err) },
          )
        }
      },
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request))
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        let body: AddProjectFolderInput
        try {
          body = (await request.json()) as AddProjectFolderInput
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        try {
          return Response.json(await addProjectFolder(params.id, body, explicitProjectProfile(request)))
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Add folder failed'
          return Response.json(
            { error: msg },
            { status: projectsErrorStatus(err) },
          )
        }
      },
      DELETE: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request))
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        let body: { path?: string }
        try {
          body = (await request.json()) as { path?: string }
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        try {
          return Response.json(
            await removeProjectFolder(params.id, body.path ?? '', explicitProjectProfile(request)),
          )
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : 'Remove folder failed'
          return Response.json(
            { error: msg },
            { status: projectsErrorStatus(err) },
          )
        }
      },
    },
  },
})
