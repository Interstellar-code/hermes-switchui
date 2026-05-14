import type { MockTextMessageScenario } from './types'

type MockTextMessageInput = {
  requestKey?: string
  recipient?: string
  message?: string
  messageText?: string
  confirmationText?: string
}

export function buildMockTextMessageScenario(
  input: MockTextMessageInput = {},
): MockTextMessageScenario {
  const recipient = input.recipient?.trim() || 'Joseph'
  const messageText =
    input.messageText?.trim() ||
    input.message?.trim() ||
    'I will be late for the soccer game.'
  const confirmationText = input.confirmationText?.trim() || 'Delivered'

  return {
    requestKey: input.requestKey,
    recipient,
    messageText,
    confirmationText,
    steps: [{ text: messageText }, { text: confirmationText }],
  }
}
