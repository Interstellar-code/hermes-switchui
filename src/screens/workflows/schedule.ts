/**
 * schedule.ts — single-line `schedule:`/`cron:` detection shared by the
 * workflows library rail and the table's SCHEDULE column (F1/F2 review:
 * one regex, no newline crossing). Node-level keys are indented; the match
 * is confined to one line via [ \t].
 */

const SCHEDULE_LINE_RE =
  /^[ \t]*(?:schedule|cron):[ \t]*(['"]?)([^'"\r\n]+)\1[ \t]*$/m
const ANY_SCHEDULE_RE = /^[ \t]+(?:schedule|cron):/m

/** The workflow-level cron expression from YAML, or null. */
export function getScheduleLabel(yaml: string): string | null {
  const match = SCHEDULE_LINE_RE.exec(yaml || '')
  return match ? match[2].trim() : null
}

/** True when the YAML declares any (node-level) schedule/cron key. */
export function isScheduledYaml(yaml: string): boolean {
  return ANY_SCHEDULE_RE.test(yaml || '')
}
