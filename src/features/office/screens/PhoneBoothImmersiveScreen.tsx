import type { MockPhoneCallScenario } from '@/lib/office/call/types'

export type PhoneCallStep =
  | 'dialing'
  | 'ringing'
  | 'speaking'
  | 'reply'
  | 'complete'

type PhoneBoothImmersiveScreenProps = {
  scenario: MockPhoneCallScenario
  step: PhoneCallStep
  typedDigits: string
}

export function PhoneBoothImmersiveScreen(_props: PhoneBoothImmersiveScreenProps) {
  return null
}
