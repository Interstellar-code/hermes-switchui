export type ToolCallContent = {
  type: 'toolCall'
  id?: string
  name?: string
  arguments?: Record<string, unknown>
  partialJson?: string
}

export type ToolResultContent = {
  type: 'toolResult'
  toolCallId?: string
  toolName?: string
  content?: Array<{ type?: string; text?: string }>
  details?: Record<string, unknown>
  isError?: boolean
}

export type TextContent = {
  type: 'text'
  text?: string
  textSignature?: string
}

export type ThinkingContent = {
  type: 'thinking'
  thinking?: string
  thinkingSignature?: string
}

export type MessageContent =
  | TextContent
  | ToolCallContent
  | ToolResultContent
  | ThinkingContent

export type StreamingToolCall = {
  id: string
  name: string
  phase: string
  args?: unknown
  preview?: string
  result?: string
  firstSeenAt?: number
}

export type ChatAttachment = {
  id?: string
  name?: string
  contentType?: string
  size?: number
  url?: string
  dataUrl?: string
  previewUrl?: string
  width?: number
  height?: number
}

export type StreamingStatus =
  | 'idle'
  | 'streaming'
  | 'complete'
  | 'interrupted'
  | 'error'

export type ChatMessage = {
  role?: string
  id?: string
  messageId?: string
  clientId?: string
  client_id?: string
  nonce?: string
  idempotencyKey?: string
  status?: string
  content?: Array<MessageContent>
  attachments?: Array<ChatAttachment>
  toolCallId?: string
  toolName?: string
  details?: Record<string, unknown>
  isError?: boolean
  timestamp?: number | string
  createdAt?: number | string
  created_at?: number | string
  time?: number | string
  ts?: number | string
  text?: string
  body?: string
  message?: string
  streamToolCalls?: Array<StreamingToolCall>
  __streamToolCalls?: Array<StreamingToolCall>
  __receiveTime?: number
  __historyIndex?: number
  historyIndex?: number
  __realtimeSequence?: number
  __realtimeSource?: string
  __execNotification?: unknown
  __isNarration?: boolean
  [key: string]: unknown
  __optimisticId?: string
  __streamingStatus?: StreamingStatus
  __streamingText?: string
  __streamingThinking?: string
}

export type SessionTitleStatus = 'idle' | 'generating' | 'ready' | 'error'
export type SessionTitleSource = 'auto' | 'manual'

export type SessionSummary = {
  key?: string
  label?: string
  title?: string
  derivedTitle?: string
  updatedAt?: number
  lastMessage?: ChatMessage | null
  friendlyId?: string
  titleStatus?: SessionTitleStatus
  titleSource?: SessionTitleSource
  titleError?: string | null
  preview?: string | null
  isActive?: boolean
  is_active?: boolean
  tokenCount?: number
  totalTokens?: number
  messageCount?: number
  message_count?: number
  toolCallCount?: number
  tool_call_count?: number
  model?: string
  status?: string
  kind?: string
  source?: string
}

export type SessionListResponse = {
  sessions?: Array<SessionSummary>
}

export type HistoryResponse = {
  sessionKey: string
  sessionId?: string
  messages: Array<ChatMessage>
}

export type SessionMeta = {
  key: string
  friendlyId: string
  title?: string
  derivedTitle?: string
  label?: string
  updatedAt?: number
  lastMessage?: ChatMessage | null
  titleStatus?: SessionTitleStatus
  titleSource?: SessionTitleSource
  titleError?: string | null
  preview?: string | null
  tokenCount?: number
  totalTokens?: number
  messageCount?: number
  toolCallCount?: number
  model?: string
  status?: string
  kind?: string
  /** Gateway origin: 'telegram' | 'cron' | 'cli' | 'api_server' | 'a2a_fleet' | 'local' | '' */
  source?: string
  isActive?: boolean
}

export type PathsPayload = {
  agentId: string
  stateDir: string
  sessionsDir: string
  storePath: string
}
