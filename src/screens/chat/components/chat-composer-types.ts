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
/** Client mirror of `profile-scope.ts`'s `ProfileGatewayEntry` (structural on
 *  purpose — that module is server-only and pulls in gateway-capabilities). */
export type ProfileGatewayEntry = {
  profile: string
  /** `api_server` port of that profile's live gateway; `null` when a gateway
   *  process is running for it but exposes no HTTP API. A profile with NO
   *  gateway at all has no entry here. */
  apiPort: number | null
  /** The one entry proven to be the gateway this workspace talks to. */
  matchesConfiguredApi: boolean
}

export type ScopeStatusResponse = {
  /** `'unknown'` = topology couldn't be established well enough to authorise
   *  a profile; it must never read as "served". See `reason`. */
  mode: 'single' | 'multiplex' | 'unknown'
  servedProfiles: Array<string> | null
  sessionCounts: Record<string, number>
  /** The non-multiplexed gateway's own profile — the only one an unprefixed
   *  request provably reaches. `null` under multiplex / unknown. */
  servingProfile?: string | null
  /** Why `mode` is `'unknown'`. `'multiple-gateways'` means the probe SUCCEEDED
   *  and the dashboard is healthy — several independent per-profile gateways
   *  are running and none could be matched to this workspace's gateway URL. */
  reason?: 'remote-gated' | 'probe-failed' | 'multiple-gateways' | null
  /** Per-profile gateway roster; non-null only for the multi-gateway topology. */
  profileGateways?: Array<ProfileGatewayEntry> | null
}
