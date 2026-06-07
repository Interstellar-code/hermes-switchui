import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { ComposerShadcn } from '@/screens/chat/components/composer-shadcn/composer-shadcn'
import { useShadcnComposer } from '@/lib/feature-flags'

// Dev-only sandbox themes to prove the composer inherits the token bridge.
const PREVIEW_THEMES = [
  'claude-nous',
  'claude-official',
  'claude-slate',
  'matrix',
  'claude-nous-light',
] as const

function ComposerPreviewPage() {
  const [theme, setTheme] = React.useState<string>('claude-nous')
  const [shadcnComposerEnabled, setShadcnComposerEnabled] = useShadcnComposer()

  // Apply the chosen theme locally to the <html> element for the sandbox.
  React.useEffect(() => {
    const root = document.documentElement
    const prev = root.getAttribute('data-theme')
    root.setAttribute('data-theme', theme)
    return () => {
      if (prev) {
        root.setAttribute('data-theme', prev)
      }
    }
  }, [theme])

  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-lg font-semibold">shadcn composer — sandbox</h1>
          <p className="text-sm text-muted-foreground">
            Isolated preview of the cherry-picked operator1 composer features on
            shadcn/ui. Mock data only — not wired to chat.
          </p>
          {/* Dev toggle for the live drop-in shadcn composer flag (Phase 2 #12).
              Flips localStorage `switchui:shadcn-composer`; affects /chat. */}
          <label className="flex w-fit items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground">
            <input
              type="checkbox"
              checked={shadcnComposerEnabled}
              onChange={(e) => setShadcnComposerEnabled(e.target.checked)}
            />
            <span>
              Use shadcn composer on <code>/chat</code> (default OFF)
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-muted-foreground">Theme:</span>
            {PREVIEW_THEMES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                className={
                  'rounded-md border border-border px-2 py-1 text-xs transition-colors ' +
                  (t === theme
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-card-foreground hover:bg-accent hover:text-accent-foreground')
                }
              >
                {t}
              </button>
            ))}
          </div>
        </header>

        <ComposerShadcn />
      </div>
    </div>
  )
}

export const Route = createFileRoute('/composer-preview')({
  component: ComposerPreviewPage,
})
