import { Outlet, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type {DocsTree} from '@/components/docs/docs-sidebar';
import { DocsSidebar  } from '@/components/docs/docs-sidebar'
import { DocsScrollProgress } from '@/components/docs/docs-scroll-progress'
import '@/styles/docs-prose.css'

export const Route = createFileRoute('/docs')({
  ssr: false,
  component: DocsLayout,
})

type DocsApiResponse = {
  ok: boolean
  tree?: DocsTree
  error?: string
}

async function fetchDocsTree(): Promise<DocsTree> {
  const res = await fetch('/api/docs', { credentials: 'same-origin' })
  if (res.status === 401) {
    throw new Error('Unauthorized')
  }
  const data = (await res.json()) as DocsApiResponse
  if (!data.ok || !data.tree) {
    throw new Error(data.error ?? 'Failed to load docs')
  }
  return data.tree
}

function DocsLayout() {
  const treeQuery = useQuery({
    queryKey: ['docs', 'tree'],
    queryFn: fetchDocsTree,
    staleTime: 60_000,
  })

  if (treeQuery.isError) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-[var(--theme-muted)]">
        {(treeQuery.error).message === 'Unauthorized'
          ? 'You must be signed in to view documentation.'
          : 'Failed to load documentation.'}
      </div>
    )
  }

  const tree: DocsTree = treeQuery.data ?? { rootPages: [], folders: [] }

  return (
    <div className="flex h-full min-h-0 flex-1">
      <DocsSidebar tree={tree} />
      <div
        className="relative flex-1 overflow-y-auto"
        data-docs-scroll
      >
        <DocsScrollProgress />
        <Outlet />
      </div>
    </div>
  )
}
