/**
 * Ids forwarded into workflow-engine plugin paths/bodies (definitions, runs,
 * schedules). All-dot ids are rejected: `.` / `..` would traverse the URL path.
 */
export const WORKFLOW_ID_RE = /^(?!\.+$)[A-Za-z0-9_:.-]{1,128}$/
