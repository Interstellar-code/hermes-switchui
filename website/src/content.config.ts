import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { docsSchema } from '@astrojs/starlight/schema'

const DOC_GLOB = '{markdown,mdown,mkdn,mkd,mdwn,md,mdx}'
const docsBase = new URL('../../docs/', import.meta.url)

function generateId({ entry, data }: { entry: string; data: Record<string, unknown> }) {
  if (typeof data.slug === 'string' && data.slug.length > 0) return data.slug
  const slug = entry.replace(/\.(markdown|mdown|mkdn|mkd|mdwn|md|mdx)$/i, '')
  if (slug === 'index') return ''
  return slug.endsWith('/index') ? slug.slice(0, -6) : slug
}

export const collections = {
  docs: defineCollection({
    loader: glob({
      base: docsBase,
      pattern: [
        `welcome.${DOC_GLOB}`,
        `faq.${DOC_GLOB}`,
        `deployment/**/*.${DOC_GLOB}`,
        `getting-started/**/*.${DOC_GLOB}`,
        `help/**/*.${DOC_GLOB}`,
        `how-to/**/*.${DOC_GLOB}`,
        `knowledge/**/*.${DOC_GLOB}`,
        `main/**/*.${DOC_GLOB}`,
        `plugins/**/*.${DOC_GLOB}`,
        `settings/**/*.${DOC_GLOB}`,
        `tips/**/*.${DOC_GLOB}`,
        `troubleshooting/**/*.${DOC_GLOB}`,
      ],
      generateId,
    }),
    schema: docsSchema(),
  }),
}
