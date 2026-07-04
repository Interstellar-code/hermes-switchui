import type { HomeChannel } from './tasks-api'

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function formatHomeChannelLabel(channel: HomeChannel): string {
  const platformLabel = titleCase(channel.platform)
  const parts = [platformLabel]

  if (channel.name?.trim()) parts.push(channel.name.trim())

  if (channel.platform === 'telegram' && channel.thread_id?.trim()) {
    parts.push(`Topic #${channel.thread_id.trim()}`)
  } else if (channel.chat_id?.trim()) {
    parts.push(`Chat ${channel.chat_id.trim()}`)
  }

  return parts.join(' · ')
}

export function getMessagingDeliveryHint(deliver: Array<string>): string | null {
  if (!deliver.includes('telegram')) return null
  return 'Telegram deliveries respect topic mode when a thread is configured, and Hermes applies timeouts per delivery attempt instead of one long global wait.'
}
