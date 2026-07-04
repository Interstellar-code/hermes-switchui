/**
 * template-card.tsx — grid-view card for a board template.
 * Reuses the boards-namespace card classes (.brd-card / .bc-*) already styled
 * in matrix-boards.css, mirroring BoardCard in boards-screen.tsx.
 */

import type { KanbanTemplateSummary } from '@/lib/hermes-kanban-types'
import { useTemplate } from '@/lib/board-templates-api'
import { summarizeTemplateSchedule } from '@/lib/kanban-template-schedule'

function glyph(name: string): string {
  return (name || '?').slice(0, 2).toUpperCase()
}

export function TemplateCard({
  template,
  taskCount,
  onOpen,
  onInstantiate,
  onDelete,
}: {
  template: KanbanTemplateSummary
  taskCount?: number
  onOpen: (slug: string) => void
  onInstantiate: (template: KanbanTemplateSummary) => void
  onDelete: (template: KanbanTemplateSummary) => void
}) {
  const templateQuery = useTemplate(template.slug, true)
  const scheduleSummary = templateQuery.data
    ? summarizeTemplateSchedule(templateQuery.data)
    : null
  const scheduledTaskCount = scheduleSummary?.scheduledTaskCount ?? 0
  const recurrenceLabel =
    scheduleSummary?.recurrenceLabel ?? (template.has_recurrence ? 'Recurring' : null)

  return (
    <div className="brd-card" style={{ ['--bc' as string]: template.color || '#5ad3ff' }}>
      <div className="bc-head">
        <div className="bc-glyph">{glyph(template.name || template.slug)}</div>
        <div className="bc-info">
          <div className="bc-name">{template.name || template.slug}</div>
          <div className="bc-type">{template.slug}</div>
        </div>
        <div className="bc-right">
          {template.has_recurrence ? (
            <span className="status-pill active">
              <span className="d" />
              recurring
            </span>
          ) : null}
        </div>
      </div>

      {template.description ? <div className="bc-desc">{template.description}</div> : null}

      <div className="bc-stats">
        <div className="bc-stat">
          <span className="bsv">{taskCount ?? '—'}</span>
          <span className="bsl">Tasks</span>
        </div>
        <div className="bc-stat">
          <span className="bsv">{template.variables.length}</span>
          <span className="bsl">Variables</span>
        </div>
        <div className="bc-stat">
          <span className="bsv">{scheduledTaskCount > 0 ? scheduledTaskCount : '—'}</span>
          <span className="bsl">Scheduled</span>
        </div>
        <div className="bc-stat">
          <span className="bsv">{template.has_recurrence ? 'On' : '—'}</span>
          <span className="bsl">Recurrence</span>
        </div>
      </div>

      {recurrenceLabel ? (
        <div className="bc-desc" style={{ marginTop: 0 }}>
          {recurrenceLabel}
        </div>
      ) : null}

      <div className="bc-foot">
        <div className="bc-acts">
          <button className="btn-mini prim" onClick={() => onInstantiate(template)}>Use</button>
          <button className="btn-mini" onClick={() => onOpen(template.slug)}>Edit</button>
          <button className="btn-mini danger" onClick={() => onDelete(template)}>Delete</button>
        </div>
      </div>
    </div>
  )
}
