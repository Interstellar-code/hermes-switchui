export type JanitorResetRequest = Record<string, unknown>

// Back-compat: retro-office code still imports this cue type from here.
export type OfficeCleaningCue = {
  id?: string
  [key: string]: unknown
}

export function createJanitorResetRequest(): JanitorResetRequest {
  return {}
}
