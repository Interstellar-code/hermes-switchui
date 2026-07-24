import { useCallback, useEffect } from 'react'

import {
  clearHistoryMessages,
  updateHistoryMessageByClientIdEverywhere,
} from '../chat-queries'
import {
  CHAT_OPEN_SETTINGS_EVENT,
  CHAT_PENDING_COMMAND_STORAGE_KEY,
  CHAT_RUN_COMMAND_EVENT,
} from '../chat-events'
import { textFromMessage } from '../utils'
import { setPendingGeneration } from '../pending-send'
import type {
  ChatComposerAttachment,
  ChatComposerHelpers,
  ThinkingLevel,
} from '../components/chat-composer-types'
import type { ChatMessage } from '../types'
import type { ChatRunCommandDetail } from '../chat-events'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { UserCommandRecord } from '@/lib/commands-api'
import type { ActiveSendRecord } from './use-send-message-state'
import type { QueryClient } from '@tanstack/react-query'
import {
  expandUserCommandPrompt,
  findEnabledCommandBySlash,
} from '@/lib/commands-api'
import { toast } from '@/components/ui/toast'

// --- Helpers moved from chat-screen.tsx (used only by /save) ---

function sanitizeExportToken(value: string): string {
  return value
    .trim()
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/^-+|-+$/g, '')
}

function exportConversationTranscript(payload: {
  sessionLabel: string
  messages: Array<ChatMessage>
}) {
  if (typeof document === 'undefined') return false

  const sessionToken =
    sanitizeExportToken(payload.sessionLabel) || 'conversation'
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const body = payload.messages
    .map((message) => {
      const role =
        typeof message.role === 'string' && message.role.trim()
          ? message.role.trim().toUpperCase()
          : 'MESSAGE'
      const text = textFromMessage(message).trim()
      const attachments = Array.isArray(message.attachments)
        ? message.attachments
            .map((attachment) => attachment.name.trim())
            .filter((value): value is string => Boolean(value))
        : []

      const lines = [`## ${role}`]
      if (text) lines.push(text)
      if (attachments.length > 0) {
        lines.push('', 'Attachments:')
        for (const attachment of attachments) {
          lines.push(`- ${attachment}`)
        }
      }
      return lines.join('\n')
    })
    .join('\n\n')
    .trim()

  const content = `# Hermes Conversation Export\n\nSession: ${payload.sessionLabel}\nExported: ${new Date().toISOString()}\n\n${body || '_No messages in this conversation._'}\n`
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${sessionToken}-${timestamp}.md`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  return true
}

export type UseSlashCommandsParams = {
  // Session routing
  navigate: (opts: {
    to: string
    params?: Record<string, string>
    replace?: boolean
  }) => void
  forcedSessionKey: string | undefined
  resolvedSessionKey: string | undefined
  activeSessionKey: string | undefined
  activeFriendlyId: string

  // Data
  queryClient: QueryClient
  finalDisplayMessages: Array<ChatMessage>
  enabledUserCommands: Array<UserCommandRecord>

  // Stream control (from useSendMessageState + useStreamingMessage)
  cancelStreaming: () => void
  setSending: Dispatch<SetStateAction<boolean>>
  setWaitingForResponse: (waiting: boolean) => void
  activeSendRef: RefObject<ActiveSendRecord | null>

  // UI callbacks
  handleThinkingLevelChange: (level: ThinkingLevel) => void
  renameSession: (
    sessionKey: string,
    friendlyId: string | null,
    newTitle: string,
  ) => Promise<void>

  // Composer send — passed as a ref bridge because useComposerSend itself
  // consumes handleUiSlashCommand/expandCustomSlashCommand from this hook,
  // creating a dependency cycle. The ref is populated by chat-screen.tsx
  // immediately after useComposerSend returns. This mirrors the bridge-ref
  // pattern already used for cancelStreamingRef / startStreamingRef.
  sendRef: RefObject<
    | ((
        body: string,
        attachments: Array<ChatComposerAttachment>,
        fastMode: boolean,
        helpers: ChatComposerHelpers,
      ) => Promise<void>)
    | null
  >
  commandHelpers: ChatComposerHelpers

  // Pending-command gate (from useEnabledUserCommands)
  userCommandsPending: boolean
}

export type UseSlashCommandsResult = {
  handleUiSlashCommand: (command: string) => boolean
  expandCustomSlashCommand: (input: string) => string | null
  runPaletteSlashCommand: (command: string) => void
}

export function useSlashCommands(
  params: UseSlashCommandsParams,
): UseSlashCommandsResult {
  const {
    navigate,
    forcedSessionKey,
    resolvedSessionKey,
    activeSessionKey,
    activeFriendlyId,
    queryClient,
    finalDisplayMessages,
    enabledUserCommands,
    cancelStreaming,
    setSending,
    setWaitingForResponse,
    activeSendRef,
    handleThinkingLevelChange,
    renameSession,
    sendRef,
    commandHelpers,
    userCommandsPending,
  } = params

  const handleUiSlashCommand = useCallback(
    (command: string) => {
      const trimmedCommand = command.trim()
      if (!trimmedCommand.startsWith('/')) return false

      // Token + argument split (commands like `/title <name>` carry an arg).
      const [slashToken = '', ...slashArgParts] = trimmedCommand.split(/\s+/)
      const slashArg = slashArgParts.join(' ').trim()

      if (trimmedCommand === '/new' || trimmedCommand === '/reset') {
        // Use the explicit 'new' session sentinel rather than '/chat' alone.
        // The /chat index route redirects to the last-active session via
        // localStorage, so '/new' must route directly to the new sentinel.
        navigate({
          to: '/chat/$sessionKey',
          params: { sessionKey: 'new' },
        })
        return true
      }

      if (trimmedCommand === '/clear') {
        const sessionKey =
          forcedSessionKey ||
          resolvedSessionKey ||
          activeSessionKey ||
          activeFriendlyId
        clearHistoryMessages(queryClient, activeFriendlyId, sessionKey)
        toast('Chat cleared', { type: 'success' })
        return true
      }

      if (trimmedCommand === '/model' || trimmedCommand === '/skin') {
        window.dispatchEvent(
          new CustomEvent(CHAT_OPEN_SETTINGS_EVENT, {
            detail: {
              section: trimmedCommand === '/skin' ? 'appearance' : 'claude',
            },
          }),
        )
        return true
      }

      if (trimmedCommand === '/skills') {
        navigate({ to: '/skills' })
        return true
      }

      if (trimmedCommand === '/plugins') {
        navigate({ to: '/plugins' })
        return true
      }

      if (trimmedCommand === '/save') {
        const exported = exportConversationTranscript({
          sessionLabel: activeFriendlyId || 'conversation',
          messages: finalDisplayMessages,
        })
        if (exported) {
          toast('Conversation exported', { type: 'success' })
        }
        return true
      }

      if (slashToken === '/stop') {
        // Inline abort — mirrors handleAbortStreaming, which is declared later
        // in the component; referencing it here would hit the same render-time
        // TDZ as the interrupted-affordance handlers.
        const activeSend = activeSendRef.current
        if (activeSend?.clientId) {
          updateHistoryMessageByClientIdEverywhere(
            queryClient,
            activeSend.clientId,
            (message) => ({ ...message, status: 'sent' }),
          )
        }
        activeSendRef.current = null
        cancelStreaming()
        setSending(false)
        setPendingGeneration(false)
        setWaitingForResponse(false)
        toast('Agent stopped', { type: 'info' })
        return true
      }

      if (slashToken === '/title') {
        if (!slashArg) {
          toast('Usage: /title <name>', { type: 'info' })
          return true
        }
        const sessionKey =
          forcedSessionKey ||
          resolvedSessionKey ||
          activeSessionKey ||
          activeFriendlyId
        if (sessionKey) {
          void renameSession(sessionKey, activeFriendlyId, slashArg)
          toast(`Title set: ${slashArg}`, { type: 'success' })
        }
        return true
      }

      if (slashToken === '/reasoning') {
        const level = slashArg.toLowerCase()
        if (level === 'off' || level === 'low' || level === 'adaptive') {
          handleThinkingLevelChange(level)
          toast(`Reasoning: ${level}`, { type: 'success' })
        } else {
          toast('Usage: /reasoning <off | low | adaptive>', { type: 'info' })
        }
        return true
      }

      return false
    },
    [
      activeFriendlyId,
      activeSessionKey,
      cancelStreaming,
      finalDisplayMessages,
      forcedSessionKey,
      handleThinkingLevelChange,
      navigate,
      queryClient,
      renameSession,
      resolvedSessionKey,
    ],
  )

  const expandCustomSlashCommand = useCallback(
    (body: string): string | null => {
      const trimmed = body.trim()
      if (!trimmed.startsWith('/')) return null
      const [slashToken = '', ...inputParts] = trimmed.split(/\s+/)
      const command = findEnabledCommandBySlash(enabledUserCommands, slashToken)
      if (!command) return null
      return expandUserCommandPrompt(command, inputParts.join(' '))
    },
    [enabledUserCommands],
  )

  const runPaletteSlashCommand = useCallback(
    (command: string) => {
      const trimmedCommand = command.trim()
      if (!trimmedCommand.startsWith('/')) return
      if (handleUiSlashCommand(trimmedCommand)) return
      sendRef.current?.(trimmedCommand, [], false, commandHelpers)
    },
    [commandHelpers, handleUiSlashCommand, sendRef],
  )

  useEffect(() => {
    function handleRunCommand(event: Event) {
      const detail = (event as CustomEvent<ChatRunCommandDetail>).detail
      if (!detail.command) return
      runPaletteSlashCommand(detail.command)
    }

    window.addEventListener(CHAT_RUN_COMMAND_EVENT, handleRunCommand)
    return () => {
      window.removeEventListener(CHAT_RUN_COMMAND_EVENT, handleRunCommand)
    }
  }, [runPaletteSlashCommand])

  useEffect(() => {
    if (userCommandsPending) return
    const pendingCommand = window.sessionStorage.getItem(
      CHAT_PENDING_COMMAND_STORAGE_KEY,
    )
    if (!pendingCommand) return

    window.sessionStorage.removeItem(CHAT_PENDING_COMMAND_STORAGE_KEY)
    runPaletteSlashCommand(pendingCommand)
  }, [runPaletteSlashCommand, userCommandsPending])

  return {
    handleUiSlashCommand,
    expandCustomSlashCommand,
    runPaletteSlashCommand,
  }
}
