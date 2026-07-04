import type { KanbanTemplate, TemplateRecurrence } from './hermes-kanban-types'

export function countScheduledTemplateTasks(template: KanbanTemplate): number {
  return template.tasks.filter((task) => {
    if (task.scheduled_at == null) return false
    return String(task.scheduled_at).trim().length > 0
  }).length
}

export function describeTemplateRecurrence(
  recurrence: TemplateRecurrence | undefined,
): string | null {
  if (!recurrence?.enabled) return null
  if (recurrence.cron && recurrence.timezone) return `${recurrence.cron} · ${recurrence.timezone}`
  if (recurrence.cron) return recurrence.cron
  if (recurrence.timezone) return `Recurring · ${recurrence.timezone}`
  return 'Recurring'
}

export function summarizeTemplateSchedule(template: KanbanTemplate): {
  scheduledTaskCount: number
  recurrenceLabel: string | null
} {
  return {
    scheduledTaskCount: countScheduledTemplateTasks(template),
    recurrenceLabel: describeTemplateRecurrence(template.recurrence),
  }
}
