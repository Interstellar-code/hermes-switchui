import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { DocsTree } from '@/components/docs/docs-sidebar'
import { usePageTitle } from '@/hooks/use-page-title'

export const Route = createFileRoute('/docs/')({
  ssr: false,
  component: DocsIndex,
})

async function fetchTree(): Promise<DocsTree> {
  const res = await fetch('/api/docs', { credentials: 'same-origin' })
  const data = (await res.json()) as { ok: boolean; tree?: DocsTree }
  if (!data.ok || !data.tree) throw new Error('Failed to load docs')
  return data.tree
}

function DocsIndex() {
  usePageTitle('Documentation')
  const { data, isLoading } = useQuery({
    queryKey: ['docs', 'tree'],
    queryFn: fetchTree,
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="p-8 text-sm text-[var(--theme-muted)]">Loading…</div>
    )
  }

  const tree: DocsTree = data ?? { rootPages: [], folders: [] }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-2 text-3xl font-bold tracking-tight text-[var(--theme-text)]">
        Documentation
      </h1>
      <p className="mb-8 text-base text-[var(--theme-muted)]">
        Reference guides, specs, and operational notes for Hermes Switch UI.
      </p>

      {tree.rootPages.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--theme-muted)]">
            Guides
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {tree.rootPages.map((page) => (
              <li key={page.slug}>
                <Link
                  to="/docs/$"
                  params={{ _splat: page.slug }}
                  className="block rounded-md border border-[var(--theme-border)] bg-[var(--theme-sidebar)] px-4 py-3 text-sm text-[var(--theme-text)] hover:border-[var(--theme-accent)]"
                >
                  {page.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tree.folders.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--theme-muted)]">
            Sections
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {tree.folders.map((folder) => (
              <li
                key={folder.name}
                className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-sidebar)] p-4"
              >
                <h3 className="mb-2 text-sm font-medium text-[var(--theme-text)]">
                  {folder.name}
                </h3>
                <ul className="space-y-1">
                  {folder.pages.map((p) => (
                    <li key={p.slug}>
                      <Link
                        to="/docs/$"
                        params={{ _splat: p.slug }}
                        className="text-sm text-[var(--theme-muted)] hover:text-[var(--theme-accent)]"
                      >
                        {p.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tree.rootPages.length === 0 && tree.folders.length === 0 && (
        <p className="text-sm text-[var(--theme-muted)]">
          No published documentation found.
        </p>
      )}
    </div>
  )
}
