export type MockPhoneCallScenario = {
  requestKey?: string
  callee?: string
  dialNumber?: string
  spokenText?: string
  recipientReply?: string
  voiceAvailable?: boolean
  steps?: Array<{ text?: string }>
  [key: string]: unknown
}
