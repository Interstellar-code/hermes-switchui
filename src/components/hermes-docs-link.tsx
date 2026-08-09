/**
 * hermes-docs-link.tsx — inline "Docs" link that previews a page from the
 * local Hermes Agent docs checkout (`GET /api/hermes-docs`) in a popover,
 * with a fallback link to the live hosted docs.
 *
 * Used by settings sections to explain config keys with the real docs
 * instead of a tooltip that will drift from them (W7).
 */
import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Markdown } from '@/components/prompt-kit/markdown'

export type HermesDocsResponse = {
  ok: boolean
  path?: string
  content?: string
  liveUrl?: string
  error?: string
}

async function fetchHermesDoc(docPath: string): Promise<HermesDocsResponse> {
  const response = await fetch(`/api/hermes-docs?path=${encodeURIComponent(docPath)}`)
  return (await response.json()) as HermesDocsResponse
}

export type HermesDocsLinkProps = {
  /** Path relative to the docs root, e.g. `user-guide/multi-profile-gateways.md`. */
  path: string
  /** Link text. Defaults to "Docs". */
  label?: string
}

export function HermesDocsLink({ path, label = 'Docs' }: HermesDocsLinkProps) {
  const [open, setOpen] = useState(false)
  const popoverId = useId()
  const containerRef = useRef<HTMLSpanElement>(null)

  const query = useQuery({
    queryKey: ['hermes-docs', path],
    queryFn: () => fetchHermesDoc(path),
    enabled: open,
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    if (!open) return
    function handleClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const data = query.data
  const liveUrl = data?.liveUrl

  return (
    <span ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          font: 'inherit',
          fontSize: '11px',
          fontFamily: 'var(--m-font-mono)',
          color: 'var(--m-accent)',
          textDecoration: 'underline',
          textUnderlineOffset: '2px',
          cursor: 'pointer',
        }}
      >
        {label}
      </button>
      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-label={`${label} preview`}
          style={{
            position: 'absolute',
            zIndex: 50,
            top: '100%',
            left: 0,
            marginTop: '6px',
            width: 'min(420px, 80vw)',
            maxHeight: '320px',
            overflowY: 'auto',
            padding: '12px 14px',
            borderRadius: '6px',
            border: '1px solid var(--m-border, rgba(128,128,128,0.3))',
            background: 'var(--m-bg-elevated, var(--m-bg, #111))',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            fontSize: '12px',
            color: 'var(--m-text)',
          }}
        >
          {query.isLoading && (
            <div style={{ color: 'var(--m-text-faint)' }}>Loading docs…</div>
          )}
          {!query.isLoading && data?.ok && data.content ? (
            <Markdown className="text-xs">{data.content}</Markdown>
          ) : null}
          {!query.isLoading && data && !data.ok ? (
            <div style={{ color: 'var(--m-text-faint)', marginBottom: liveUrl ? '8px' : 0 }}>
              {data.error ?? 'Local docs are unavailable on this machine.'}
            </div>
          ) : null}
          {!query.isLoading && query.isError ? (
            <div style={{ color: 'var(--m-text-faint)' }}>Could not load this doc.</div>
          ) : null}
          {liveUrl && (
            <div style={{ marginTop: '8px' }}>
              <a
                href={liveUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--m-accent)', fontSize: '11px' }}
              >
                Open full docs ↗
              </a>
            </div>
          )}
        </div>
      )}
    </span>
  )
}
