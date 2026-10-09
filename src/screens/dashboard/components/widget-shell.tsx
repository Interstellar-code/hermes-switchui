import type { ReactNode } from 'react'
import type {
  DashboardLayout,
  WidgetId,
} from '@/screens/dashboard/lib/use-dashboard-layout'
import { WIDGET_CATALOG } from '@/screens/dashboard/lib/use-dashboard-layout'

/**
 * Wraps a dashboard widget so it participates in edit mode without
 * the widget itself needing to know edit state exists.
 *
 * Behavior:
 * - When `layout.editMode` is true: shows a subtle dashed outline +
 *   an X button in the top-right corner that hides the widget. The
 *   widget body remains interactive so the operator can still see
 *   what they're toggling.
 * - When edit mode is off: renders children unchanged (zero overhead
 *   layout-wise; the wrapper is just a passthrough div).
 *
 * If the widget is hidden (`!layout.isVisible(id)`), this returns
 * null in both modes — restoration happens through the EditPanel.
 */
export function WidgetShell({
  id,
  layout,
  children,
}: {
  id: WidgetId
  layout: DashboardLayout
  children: ReactNode
}) {
  if (!layout.isVisible(id)) return null

  const meta = WIDGET_CATALOG.find((w) => w.id === id)
  const canHide = meta?.hideable ?? true

  if (!layout.editMode) {
    // Plain passthrough. Wrapping in a fragment-equivalent div would
    // change the flexbox layout above us, so we skip the wrapper.
    return <>{children}</>
  }

  // Use `h-full` on the edit-mode wrapper so children that opted
  // into `flex-1`/`h-full` (e.g. Sessions Intelligence post iter 013)
  // still expand correctly when the dashboard is in edit mode.
  return (
    <div className="relative h-full">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-xl"
        style={{
          outline: '1px dashed var(--theme-accent)',
          outlineOffset: '2px',
          boxShadow:
            '0 0 0 6px color-mix(in srgb, var(--theme-accent) 8%, transparent)',
          borderRadius: 12,
        }}
      />
      <div className="relative h-full">{children}</div>
      {canHide ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            layout.hide(id)
          }}
          className="absolute -right-2 -top-2 z-10 inline-flex size-6 items-center justify-center rounded-full text-[14px] font-bold leading-none shadow-md transition-transform hover:scale-110"
          style={{
            background: 'var(--theme-card)',
            color: 'var(--theme-danger)',
            border: '1px solid var(--theme-border)',
          }}
          title={`Hide ${meta?.label ?? id}`}
          aria-label={`Hide widget ${meta?.label ?? id}`}
        >
          ×
        </button>
      ) : null}
    </div>
  )
}

/** Text for cards that depend on the analytics upstream. */
export const ANALYTICS_UNAVAILABLE =
  'Unavailable — analytics did not load. Retrying…'

const PLACEHOLDER_MESSAGE = {
  loading: 'Loading…',
  unavailable: 'Data did not load. Retrying…',
  empty: 'No data in this window',
} as const

/**
 * Titled card shell with a muted body, for ops cards whose data is
 * pending, missing, or genuinely empty. Cards use it instead of
 * returning `null` so the grid never loses a tile (and never leaves a
 * hole) just because an upstream was slow.
 */
export function CardPlaceholder({
  title,
  state,
  message,
}: {
  title: string
  state: keyof typeof PLACEHOLDER_MESSAGE
  /** Overrides the default per-state text. */
  message?: string
}) {
  return (
    <div
      aria-busy={state === 'loading' ? 'true' : undefined}
      className="flex h-full min-h-[120px] flex-col gap-2 overflow-hidden rounded-xl border p-3"
      style={{
        background:
          'linear-gradient(150deg, color-mix(in srgb, var(--theme-card) 96%, transparent), color-mix(in srgb, var(--theme-card) 92%, transparent))',
        borderColor: 'var(--theme-border)',
      }}
    >
      <h3
        className="text-[10px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: 'var(--theme-text)' }}
      >
        {title}
      </h3>
      <p
        className="font-mono text-[11px] tracking-[0.05em]"
        style={{ color: 'var(--theme-muted)' }}
      >
        {message ?? PLACEHOLDER_MESSAGE[state]}
      </p>
    </div>
  )
}
