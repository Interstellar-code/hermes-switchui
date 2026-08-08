import type { StudioGatewayAdapterType } from '@/lib/studio/settings'

type SettingsPanelProps = {
  gatewayStatus: string
  gatewayUrl: string
  gatewayToken: string
  selectedAdapterType: string
  activeAdapterType: string
  onGatewayDisconnect?: () => void
  onGatewayConnect?: () => void
  onGatewayUrlChange?: (value: string) => void
  onGatewayTokenChange?: (value: string) => void
  onGatewayAdapterTypeChange?: (value: StudioGatewayAdapterType) => void
  officeTitle: string
  officeTitleLoaded: boolean
  onOfficeTitleChange?: (title: string) => void
  remoteOfficeEnabled: boolean
  remoteOfficeSourceKind: 'presence_endpoint' | 'openclaw_gateway'
  remoteOfficeLabel: string
  remoteOfficePresenceUrl: string
  remoteOfficeGatewayUrl: string
  remoteOfficeTokenConfigured: boolean
  onRemoteOfficeEnabledChange?: (enabled: boolean) => void
  onRemoteOfficeSourceKindChange?: (kind: 'presence_endpoint' | 'openclaw_gateway') => void
  onRemoteOfficeLabelChange?: (label: string) => void
  onRemoteOfficePresenceUrlChange?: (url: string) => void
  onRemoteOfficeGatewayUrlChange?: (url: string) => void
  onRemoteOfficeTokenChange?: (token: string) => void
  voiceRepliesEnabled: boolean
  voiceRepliesVoiceId: string | null
  voiceRepliesSpeed: number
  voiceRepliesLoaded: boolean
  onVoiceRepliesToggle?: (enabled: boolean) => void
  onVoiceRepliesVoiceChange?: (voiceId: string) => void
  onVoiceRepliesSpeedChange?: (speed: number) => void
  onVoiceRepliesPreview?: (voiceId: string, voiceName: string) => void
}

export function SettingsPanel(_props: SettingsPanelProps) {
  return null
}
