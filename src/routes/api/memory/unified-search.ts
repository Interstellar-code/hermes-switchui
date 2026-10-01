import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { searchKnowledgePages } from '../../../server/knowledge-browser'
import { searchMemoryFiles } from '../../../server/memory-browser'
import { isMemoryProfile } from '../../../server/memory-profile'
import { searchMnemosyne } from '../../../server/mnemosyne-browser'
import type { KnowledgeSearchHit } from '../../../server/knowledge-browser'
import type { MemorySearchMatch } from '../../../server/memory-browser'
import type { MnemosyneSearchMatch } from '../../../server/mnemosyne-browser'

const PER_GROUP = 8

export type UnifiedSearchResponse = {
  /** $HERMES_HOME memory files — not profile-scoped (searchMemoryFiles has no profile). */
  agentFiles: Array<MemorySearchMatch>
  wiki: Array<KnowledgeSearchHit>
  memories: Array<MnemosyneSearchMatch>
  /** Groups whose search threw; they come back empty. */
  failed: Array<'agentFiles' | 'wiki' | 'memories'>
}

// One search box for the /memory page: fans out to the existing per-source
// searches and returns the top hits of each, grouped.
export const Route = createFileRoute('/api/memory/unified-search')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const q = url.searchParams.get('q') ?? ''
        if (q.length > 500) {
          return Response.json(
            { error: 'q too long (max 500)' },
            { status: 400 },
          )
        }
        const profile = url.searchParams.get('profile') ?? undefined
        if (profile !== undefined && !isMemoryProfile(profile)) {
          return Response.json({ error: 'unknown profile' }, { status: 400 })
        }

        const failed: UnifiedSearchResponse['failed'] = []
        function run<T>(
          group: UnifiedSearchResponse['failed'][number],
          fn: () => Array<T>,
        ) {
          try {
            return fn().slice(0, PER_GROUP)
          } catch {
            failed.push(group)
            return []
          }
        }
        const body: UnifiedSearchResponse = {
          agentFiles: run('agentFiles', () => searchMemoryFiles(q)),
          wiki: run('wiki', () => searchKnowledgePages(q, profile)),
          memories: run('memories', () =>
            searchMnemosyne(q, PER_GROUP, undefined, profile),
          ),
          failed,
        }
        return Response.json(body, {
          headers: { 'Cache-Control': 'private, no-store' },
        })
      },
    },
  },
})
