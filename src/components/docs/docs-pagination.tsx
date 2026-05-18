import { Link } from '@tanstack/react-router'

type PageLink = { slug: string; title: string } | null

export function DocsPagination({
  prev,
  next,
}: {
  prev: PageLink
  next: PageLink
}) {
  return (
    <div className="mt-12 flex items-center justify-between border-t border-[var(--theme-border)] pt-6">
      {prev ? (
        <Link
          to="/docs/$"
          params={{ _splat: prev.slug }}
          className="flex items-center gap-1 text-sm text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
        >
          <span aria-hidden>‹</span>
          {prev.title}
        </Link>
      ) : (
        <span />
      )}

      {next ? (
        <Link
          to="/docs/$"
          params={{ _splat: next.slug }}
          className="flex items-center gap-1 text-sm text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
        >
          {next.title}
          <span aria-hidden>›</span>
        </Link>
      ) : (
        <span />
      )}
    </div>
  )
}
