export type StandupMeetingPhase = 'gathering' | 'in_progress' | 'complete' | 'idle'

export type StandupCard = {
  agentId: string
  agentName?: string
  speech: string
}

export type StandupMeeting = {
  id?: string
  phase?: StandupMeetingPhase
  participantOrder: Array<string>
  arrivedAgentIds: Array<string>
  currentSpeakerAgentId?: string | null
  cards: Array<StandupCard>
}
