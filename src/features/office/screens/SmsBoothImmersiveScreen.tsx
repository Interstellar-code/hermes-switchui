import type { MockTextMessageScenario } from '@/lib/office/text/types'

export type TextMessageStep =
  | 'selecting_contact'
  | 'composing'
  | 'sending'
  | 'delivered'
  | 'reply'
  | 'complete'

type SmsBoothImmersiveScreenProps = {
  scenario: MockTextMessageScenario
  step: TextMessageStep
  typedMessage: string
  activeKey: string | null
  contacts: string[]
  activeContactIndex: number | null
}

export function SmsBoothImmersiveScreen(_props: SmsBoothImmersiveScreenProps) {
  return null
}
