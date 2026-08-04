import type { Ref } from 'react'

export type ChatComposerAttachment = {
  id: string
  name: string
  contentType: string
  size: number
  dataUrl?: string
  previewUrl?: string
  kind?: 'image' | 'file' | 'audio'
}

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'adaptive'

export type ChatComposerHelpers = {
  reset: () => void
  setValue: (value: string) => void
  setAttachments: (attachments: Array<ChatComposerAttachment>) => void
}

export type ChatComposerHandle = {
  setValue: (value: string) => void
  insertText: (value: string) => void
  addFiles: (files: Array<File>) => Promise<void>
}

export type ChatComposerProps = {
  onSubmit: (
    value: string,
    attachments: Array<ChatComposerAttachment>,
    fastMode: boolean,
    helpers: ChatComposerHelpers,
  ) => void | Promise<void>
  isLoading: boolean
  disabled: boolean
  sessionKey?: string
  wrapperRef?: Ref<HTMLDivElement>
  composerRef?: Ref<ChatComposerHandle>
  focusKey?: string
  onNewSession?: () => void
  onToggleWebSearch?: (enabled: boolean) => void
  webSearchEnabled?: boolean
  thinkingLevel?: ThinkingLevel
  onThinkingLevelChange?: (level: ThinkingLevel) => void
  onAbort?: () => void
  embedded?: boolean
  hideModelSelector?: boolean
}

export type ProfileSummary = {
  name: string
  active?: boolean
  model?: string
  provider?: string
  skillCount?: number
}

export type ProfilesListResponse = {
  profiles?: Array<ProfileSummary>
  activeProfile?: string
}

export type WorkspaceEntry = {
  name: string
  path: string
}

export type WorkspaceDetectionResponse = {
  path?: string
  folderName?: string
  source?: string
  isValid?: boolean
  workspaces?: Array<WorkspaceEntry>
  last?: string
}

export type ModelInfoApiResponse = {
  gatewayMode?: string | null
  supportsRuntimeSwitching?: boolean | null
  vanillaAgent?: boolean | null
  /** Gateway's live active model/provider (what the agent actually runs). */
  activeModel?: string | null
  activeProvider?: string | null
}

export type ModelSwitchNotice = {
  tone: 'success' | 'error'
  message: string
  retryModel?: string
  retryProvider?: string
}

/** The `scope` field nested in `GET /api/gateway-status` — multiplex
 * topology for the composer's scope picker. `mode`/`servedProfiles` mirror
 * `profile-scope.ts`'s `GatewayMode` (a different concept from
 * `gateway-status.ts`'s top-level `mode`, which is the unrelated
 * vanilla/enhanced chat-transport mode from `gateway-capabilities.ts`). */
export type ScopeStatusResponse = {
  mode: 'single' | 'multiplex'
  servedProfiles: Array<string> | null
  sessionCounts: Record<string, number>
}
