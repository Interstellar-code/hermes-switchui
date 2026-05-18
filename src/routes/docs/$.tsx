import { createFileRoute, notFound } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { usePageTitle } from '@/hooks/use-page-title'
import { DocsRenderer } from '@/components/docs/docs-renderer'
import { DocsToc } from '@/components/docs/docs-toc'
import { DocsPagination } from '@/components/docs/docs-pagination'
import { DocsMermaid } from '@/components/docs/docs-mermaid'
import { DocsHighlight } from '@/components/docs/docs-highlight'

export const Route = createFileRoute('/docs/$')({
  ssr: false,
  component: DocsCatchAll,
})

type DocPageResponse = {
  ok: boolean
  page?: {
    slug: string
    title: string
    description: string
    content: string
  }
  html?: string
  prev?: { slug: string; title: string } | null
  next?: { slug: string; title: string } | null
  error?: string
}

async function fetchDocPage(slug: string): Promise<DocPageResponse> {
  const res = await fetch(
    `/api/docs?slug=${encodeURIComponent(slug)}`,
    { credentials: 'same-origin' },
  )
  if (res.status === 404) {
    throw notFound()
  }
  const data = (await res.json()) as DocPageResponse
  if (!data.ok) {
    throw new Error(data.error ?? 'Failed to load doc')
  }
  return data
}

function DocsCatchAll() {
  const params = Route.useParams()
  const slug = params._splat ?? ''
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['docs', 'page', slug],
    queryFn: () => fetchDocPage(slug),
    enabled: slug.length > 0,
  })

  usePageTitle(data?.page?.title ?? 'Documentation')

  if (isLoading) {
    return (
      <div className="p-8 text-sm text-[var(--theme-muted)]">Loading…</div>
    )
  }

  if (isError) {
    return (
      <div className="p-8 text-sm text-[var(--theme-muted)]">
        {(error).message === 'Unauthorized'
          ? 'You must be signed in to view documentation.'
          : 'Page not found.'}
      </div>
    )
  }

  if (!data?.page || !data.html) return null

  return (
    <div className="flex gap-8 py-8 pl-8">
      <article className="min-w-0 flex-1">
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-[var(--theme-text)]">
          {data.page.title}
        </h1>
        {data.page.description && (
          <p className="mb-8 text-lg text-[var(--theme-muted)]">
            {data.page.description}
          </p>
        )}
        <DocsRenderer html={data.html} />
        <DocsMermaid trigger={data.page.slug} />
        <DocsHighlight trigger={data.page.slug} />
        <DocsPagination
          prev={data.prev ?? null}
          next={data.next ?? null}
        />
      </article>
      <DocsToc content={data.page.content} />
    </div>
  )
}
