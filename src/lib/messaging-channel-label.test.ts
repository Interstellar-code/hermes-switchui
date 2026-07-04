import { describe, expect, it } from 'vitest'
import {
  formatHomeChannelLabel,
  getMessagingDeliveryHint,
} from './messaging-channel-label'

describe('messaging-channel-label', () => {
  it('surfaces telegram topic threads when thread_id exists', () => {
    expect(
      formatHomeChannelLabel({
        platform: 'telegram',
        name: 'Ops room',
        chat_id: '123',
        thread_id: '77',
      }),
    ).toBe('Telegram · Ops room · Topic #77')
  })

  it('falls back to chat id for non-topic channels', () => {
    expect(
      formatHomeChannelLabel({
        platform: 'discord',
        chat_id: 'chan-1',
      }),
    ).toBe('Discord · Chat chan-1')
  })

  it('returns a telegram-specific delivery hint only when telegram is selected', () => {
    expect(getMessagingDeliveryHint(['local', 'telegram'])).toContain('topic mode')
    expect(getMessagingDeliveryHint(['local'])).toBeNull()
  })
})
