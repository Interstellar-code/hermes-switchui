import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import {
  
  readKnowledgeBaseConfig
} from '../../../server/knowledge-config'
import {
  syncKnowledgeSource,
  validateKnowledgePathSegment,
} from '../../../server/knowledge-browser'
import type {KnowledgeBaseConfig} from '../../../server/knowledge-config';

export const Route = createFileRoute('/api/knowledge/sync')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        // Optional: allow body to override source temporarily for one-shot use
        let config: KnowledgeBaseConfig | null = null
        try {
          const text = await request.text()
          if (text) {
            config = JSON.parse(text)
          }
        } catch {
          // ignore parse errors, use stored config
        }

        if (config) {
          // Validate required shape before persisting. config came from
          // JSON.parse (untrusted) — treat as loose here even though the
          // declared type describes the happy path.
          const source = (config as { source?: { type?: unknown } }).source
          if (!source || typeof source !== 'object' || !source.type) {
            return Response.json(
              { error: 'Invalid config: source.type is required' },
              { status: 400 },
            )
          }
          if (source.type === 'github') {
            const { repo, branch } = source as {
              repo?: unknown
              branch?: unknown
            }
            if (typeof repo !== 'string' || !repo.trim()) {
              return Response.json(
                { error: 'Invalid config: source.repo must be a non-empty string' },
                { status: 400 },
              )
            }
            if (repo.trim().length > 256) {
              return Response.json(
                { error: 'Invalid config: source.repo is too long' },
                { status: 400 },
              )
            }
            if (typeof branch !== 'string' || !branch.trim()) {
              return Response.json(
                { error: 'Invalid config: source.branch must be a non-empty string' },
                { status: 400 },
              )
            }
            if (branch.trim().length > 256) {
              return Response.json(
                { error: 'Invalid config: source.branch is too long' },
                { status: 400 },
              )
            }
            try {
              validateKnowledgePathSegment(branch.trim(), 'branch')
              validateKnowledgePathSegment(repo.trim(), 'repo')
            } catch (err) {
              return Response.json(
                {
                  error:
                    err instanceof Error
                      ? err.message
                      : 'Invalid repo or branch value',
                },
                { status: 400 },
              )
            }
          }
          const { writeKnowledgeBaseConfig } = await import(
            '../../../server/knowledge-config'
          )
          writeKnowledgeBaseConfig(config)
        }

        try {
          const result = await syncKnowledgeSource()
          return Response.json(result)
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to sync knowledge source',
            },
            { status: 500 },
          )
        }
      },
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const config = readKnowledgeBaseConfig()
        return Response.json({ source: config.source })
      },
    },
  },
})
