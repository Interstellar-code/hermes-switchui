export type OfficeCleaningCue = { id?: string; [key: string]: unknown }
export type OfficeIdleLeisureArea = 'pingpong' | 'sofa' | 'gym' | 'recreation'
export type OfficeAnimationState = {
  cleaningCues?: Array<OfficeCleaningCue>
  danceUntilByAgentId?: Record<string, number>
  deskHoldByAgentId?: Record<string, boolean>
  githubHoldByAgentId?: Record<string, boolean>
  gymHoldByAgentId?: Record<string, boolean>
  idleLeisureByAgentId?: Partial<Record<string, OfficeIdleLeisureArea>>
  phoneBoothHoldByAgentId?: Record<string, boolean>
  smsBoothHoldByAgentId?: Record<string, boolean>
  qaHoldByAgentId?: Record<string, boolean>
  jukeboxHoldByAgentId?: Record<string, boolean>
}
