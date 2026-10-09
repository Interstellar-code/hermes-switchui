import { useEffect } from 'react'
import type { RefObject } from 'react'
import type {
  DashboardLayout,
  WidgetId,
} from '@/screens/dashboard/lib/use-dashboard-layout'
import { WIDGET_CATALOG } from '@/screens/dashboard/lib/use-dashboard-layout'

/**
 * Inline EDIT LAYOUT panel. Renders only when `layout.editMode` is true,
 * directly under the Ops header. One toggle chip per card (title +
 * shown/hidden state); changes apply live through the shared layout hook.
 *
 * - `widgetIds` limits the list to the cards the host actually renders
 *   (default: the whole catalog).
 * - Escape closes the panel and, when `returnFocusTo` is given, returns
 *   focus to the control that opened it.
 */
export function EditModePanel({
  layout,
  widgetIds,
  returnFocusTo,
  className,
}: {
  layout: DashboardLayout
  widgetIds?: ReadonlyArray<WidgetId>
  returnFocusTo?: RefObject<HTMLElement | null>
  className?: string
}) {
  const { editMode, setEditMode } = layout

  useEffect(() => {
    if (!editMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      setEditMode(false)
      returnFocusTo?.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [editMode, setEditMode, returnFocusTo])

  if (!editMode) return null

  const widgets = WIDGET_CATALOG.filter(
    (w) => !widgetIds || widgetIds.includes(w.id),
  )
  const shown = widgets.filter((w) => layout.isVisible(w.id)).length

  return (
    <div
      role="region"
      aria-label="Edit layout"
      className={`relative flex flex-col gap-3 overflow-hidden rounded-xl border p-3 ${className ?? ''}`}
      style={{
        background:
          'linear-gradient(120deg, color-mix(in srgb, var(--theme-accent) 6%, var(--theme-card)), color-mix(in srgb, var(--theme-card) 92%, transparent))',
        borderColor: 'var(--theme-accent)',
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
            style={{
              background:
                'color-mix(in srgb, var(--theme-accent) 18%, transparent)',
              color: 'var(--theme-accent)',
            }}
          >
            Edit mode
          </span>
          <span
            className="font-mono text-[10px] uppercase tracking-[0.15em]"
            style={{ color: 'var(--theme-muted)' }}
          >
            {shown} of {widgets.length} cards shown
          </span>
        </div>
        <div className="flex items-center gap-2">
          <PanelButton
            onClick={() => widgets.forEach((w) => layout.show(w.id))}
            title="Show every card"
          >
            Show all
          </PanelButton>
          <PanelButton onClick={layout.reset} title="Back to the default cards">
            Reset to default
          </PanelButton>
          <button
            type="button"
            onClick={() => {
              setEditMode(false)
              returnFocusTo?.current?.focus()
            }}
            className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors"
            style={{
              background:
                'linear-gradient(135deg, var(--theme-accent), color-mix(in srgb, var(--theme-accent) 60%, transparent))',
              color: 'var(--theme-on-accent, white)',
            }}
            title="Exit edit mode"
          >
            Done
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {widgets.map((w) => {
          const visible = layout.isVisible(w.id)
          return (
            <button
              key={w.id}
              type="button"
              aria-pressed={visible}
              onClick={() => (visible ? layout.hide(w.id) : layout.show(w.id))}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition-all"
              style={{
                background: visible
                  ? 'color-mix(in srgb, var(--theme-success) 14%, transparent)'
                  : 'transparent',
                border: `1px ${visible ? 'solid' : 'dashed'} ${
                  visible
                    ? 'color-mix(in srgb, var(--theme-success) 60%, transparent)'
                    : 'var(--theme-border)'
                }`,
                color: visible ? 'var(--theme-success)' : 'var(--theme-muted)',
              }}
              title={w.description}
            >
              <span
                aria-hidden
                className="inline-block size-1.5 rounded-full"
                style={{
                  background: visible
                    ? 'var(--theme-success)'
                    : 'var(--theme-muted)',
                }}
              />
              {w.label}
              <span className="font-mono text-[9px] font-normal normal-case tracking-normal opacity-80">
                {visible ? 'shown' : 'hidden'}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PanelButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void
  title: string
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors hover:bg-[var(--theme-card)]"
      style={{
        background: 'var(--theme-card)',
        borderColor: 'var(--theme-border)',
        color: 'var(--theme-text)',
      }}
    >
      {children}
    </button>
  )
}
