import type { MockPhoneCallScenario } from './types'

type MockPhoneCallInput = {
  requestKey?: string
  callee?: string
  dialNumber?: string
  message?: string
  spokenText?: string
  recipientReply?: string
  voiceAvailable?: boolean
}

export function buildMockPhoneCallScenario(
  input: MockPhoneCallInput = {},
): MockPhoneCallScenario {
  const callee = input.callee?.trim() || 'my contact'
  const dialNumber = input.dialNumber?.trim() || '555 0199'
  const spokenText =
    input.spokenText?.trim() ||
    input.message?.trim() ||
    'This is a demo call from the OpenClaw phone booth.'
  const recipientReply = input.recipientReply?.trim() || 'Got it.'

  return {
    requestKey: input.requestKey,
    callee,
    dialNumber,
    spokenText,
    recipientReply,
    voiceAvailable: input.voiceAvailable ?? false,
    steps: [{ text: spokenText }, { text: recipientReply }],
  }
}
