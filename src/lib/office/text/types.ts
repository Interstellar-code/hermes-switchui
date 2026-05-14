export type MockTextMessageScenario = {
  requestKey?: string
  recipient?: string
  messageText?: string
  confirmationText?: string
  steps?: Array<{ text?: string }>
  [key: string]: unknown
}
