import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { listPersonas, type Persona } from '../../../server/personas-browser'

// 30-second server-side cache
let _cache: { personas: PersonaListItem[]; expiresAt: number } | null = null

type PersonaListItem = Omit<Persona, 'system_prompt' | 'path'> & {
  has_more_prompt: boolean
  system_prompt_preview: string
}

const PREVIEW_LENGTH = 500

function toListItem(persona: Persona): PersonaListItem {
  const preview = persona.system_prompt.slice(0, PREVIEW_LENGTH)
  return {
    id: persona.id,
    category: persona.category,
    glyph: persona.glyph,
    name: persona.name,
    description: persona.description,
    tags: persona.tags,
    system_prompt_preview: preview,
    has_more_prompt: persona.system_prompt.length > PREVIEW_LENGTH,
  }
}

export const Route = createFileRoute('/api/personas/list')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const url = new URL(request.url)
          const bust = url.searchParams.get('bust') || url.searchParams.get('nocache')
          const now = Date.now()
          if (!_cache || _cache.expiresAt < now || bust) {
            const personas = listPersonas()
            _cache = {
              personas: personas.map(toListItem),
              expiresAt: now + 30_000,
            }
          }
          return json({ personas: _cache.personas })
        } catch (error) {
          return json(
            {
              error: error instanceof Error ? error.message : 'Failed to list personas',
              personas: [],
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
