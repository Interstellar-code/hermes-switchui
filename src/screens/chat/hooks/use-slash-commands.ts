import { useCallback, useEffect } from 'react'

import { clearHistoryMessages } from '../chat-queries'
import {
  CHAT_PENDING_COMMAND_STORAGE_KEY,
  CHAT_RUN_COMMAND_EVENT,
} from '../chat-events'
import { CHAT_OPEN_MODEL_PICKER_EVENT, switchModel } from '../components/chat-composer-services'
import { textFromMessage } from '../utils'
import type {
  ChatComposerAttachment,
  ChatComposerHelpers,
} from '../components/chat-composer-types'
import type { ChatMessage } from '../types'
import type { ChatRunCommandDetail } from '../chat-events'
import type { RefObject } from 'react'
import type { UserCommandRecord } from '@/lib/commands-api'
import type { QueryClient } from '@tanstack/react-query'
import type { HermesCommandCatalog } from '@/lib/hermes-commands-api'
import {
  expandUserCommandPrompt,
  findEnabledCommandBySlash,
} from '@/lib/commands-api'
import {
  EMPTY_HERMES_COMMAND_CATALOG,
  execAgentCommand,
  findAgentCommand,
} from '@/lib/hermes-commands-api'
import { useCommandOutputStore } from '@/stores/command-output-store'
import { OPEN_SLASH_COMMAND_MENU_EVENT } from '@/components/slash-command-menu'
import { writeTextToClipboard } from '@/lib/clipboard'
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
            // `name` is optional on the attachment type, and `.trim()` on an
            // absent one would throw mid-export — the `.filter` below already
            // drops empties, so an optional chain is the whole fix.
            .map((attachment) => attachment.name?.trim())
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

/**
 * Local spellings that resolve to a SwitchUI handler.
 *
 * `/stop` is the transitional one (§8 of the plan): SwitchUI's `/stop` aborted
 * the current stream, while the agent's `/stop` kills background processes and
 * does *not* stop the turn — opposite meanings under the same word. The command
 * is now `/interrupt`; `/stop` keeps working so existing muscle memory does not
 * break, and the agent's process-killing `/stop` is deliberately not surfaced.
 */
export const LOCAL_COMMAND_ALIASES: Readonly<Record<string, string>> = {
  '/reset': '/new',
  '/stop': '/interrupt',
  '/tasks': '/agents',
  '/fork': '/branch',
  // SwitchUI route names users are likelier to type than the agent's own.
  // `/jobs` and `/mcp` are NOT agent commands — no CommandDef exists for
  // either; the canonical agent names are `/cron` and `/reload-mcp`.
  '/jobs': '/cron',
}

/**
 * Commands this hook handles without ever touching the agent. Kept exported so
 * the menu's local list and the routing layer can be asserted against each
 * other — a menu entry with no handler would fall through to the model as
 * prose, which is the exact defect this layer exists to prevent.
 *
 * ── The shadowing rule, and the guard that enforces it ────────────────────
 * A command listed here is *shadowed*: `agentCatalogEntries`
 * (`components/slash-command-menu.tsx`) drops it from the picker, and this hook
 * answers it before the exec route ever sees it. So putting a command here that
 * is ALSO on `SLASH_EXEC_ALLOWLIST` (`server/hermes-slash-policy.ts`) makes the
 * agent's version neither advertised nor runnable — it is added to an allowlist
 * and then silently deleted.
 *
 * That happened four times in a row (`/insights`, `/profile`, `/reasoning`,
 * `/version`) after `/status` had already been fixed the same way, so the rule
 * is no longer a comment: `INTENTIONALLY_SHADOWED_COMMANDS` in
 * `server/hermes-slash-policy.ts` is the *only* permitted overlap, and three
 * tests fail loudly on any other — one on this list
 * (`slash-command-menu.test.tsx`), one on the tables below, and one on the
 * hook's actual behaviour (`use-slash-commands.test.ts`), because removing an
 * entry from this list while leaving its `DEEP_LINK_ROUTES` /
 * `SETTINGS_SECTION_COMMANDS` mapping in place would keep intercepting it
 * anyway.
 */
export const LOCAL_COMMAND_HANDLERS: ReadonlyArray<string> = [
  '/new',
  '/clear',
  '/model',
  '/title',
  '/interrupt',
  '/branch',
  '/skills',
  '/save',
  '/copy',
  '/config',
  '/skin',
  // `/help` is the ONE deliberate overlap with the exec allowlist: typing it
  // opens the picker, which *is* the help surface, and the agent's own /help
  // prints ~18KB of ASCII listing CLI commands that mostly do not work here.
  // Recorded as such in INTENTIONALLY_SHADOWED_COMMANDS.
  '/help',
  '/mcp',
  '/plugins',
  '/platforms',
  '/update',
  '/agents',
  '/cron',
  '/kanban',
  // Deliberately absent, all five formerly shadowed from here: `/insights`,
  // `/profile`, `/version` and `/reasoning` (allowlisted — the shadow deleted
  // them), and `/status` (refused server-side, but it was the first command
  // this bug hit and it stays out for the same reason). See the tables below
  // and the guard named above.
]

/**
 * §4.3 deep-links that open a settings section. `''` means the settings root.
 *
 * The section ids come from `screens/settings/lib/section-registry.ts`; the URL
 * is the settings screen's only source of truth for which section is open.
 *
 * A mapping here shadows the agent's own command just as surely as an entry in
 * `LOCAL_COMMAND_HANDLERS` does — this table is checked first, and it returns
 * `true`. So an allowlisted command must be absent from BOTH.
 *
 * NO `/version`: it is on the exec allowlist and reports the *install* — build,
 * install directory, install method, Python version, OpenAI SDK version, and
 * whether the tree is up to date. Settings → Updates knows about releases, not
 * about which tree is installed, so deep-linking there dropped four of those
 * five facts and cost the command its slot in the picker.
 */
const SETTINGS_SECTION_COMMANDS: Readonly<Partial<Record<string, string>>> = {
  '/config': '',
  '/skin': 'appearance',
  '/update': 'updates',
}

/**
 * §4.3 deep-links that open a whole screen.
 *
 * `/platforms` lands on `/dashboard`: the ops strip there carries gateway
 * health, the agent version and ~18 live platform pills. It is not on the exec
 * allowlist, so nothing is lost by routing it.
 *
 * ── What must NOT be here ────────────────────────────────────────────────
 * A mapping in this table shadows the agent's command exactly as an entry in
 * `LOCAL_COMMAND_HANDLERS` does, so the same rule applies: nothing on
 * `SLASH_EXEC_ALLOWLIST` may appear, and the guard named on that list fails if
 * one does. Four commands were removed from here for that reason, each having
 * been put on the allowlist for something the destination screen does not have:
 *
 *   • `/status`   — session id, title, model, token count, agent running. The
 *                   dashboard shows gateway health, not any of those. (The
 *                   first instance of this bug; fixed, then re-created four
 *                   times by the additions below.)
 *   • `/insights` — went to `/dashboard`, which is precisely the screen that
 *                   lacks its per-platform split, top-15 tools, top skills and
 *                   aggregate message counts.
 *   • `/profile`  — went to `/profiles`, a different thing: the command reports
 *                   which profile the *worker* resolved, which is the whole
 *                   point given hermes-agent #229.
 *   • `/version`  — went to Settings → Updates; see SETTINGS_SECTION_COMMANDS.
 *                   (It was mapped in BOTH tables; the settings one won and
 *                   this entry was unreachable dead weight.)
 */
const DEEP_LINK_ROUTES: Readonly<Partial<Record<string, string>>> = {
  '/agents': '/tasks',
  // `/jobs` IS the crons screen (CronsWizard + /api/cron/jobs) and covers
  // `edit`/`run`, which even the agent's own `cron.manage` RPC lacks.
  '/cron': '/jobs',
  // The Hermes kanban is `/tasks` (board) + `/boards` (board management),
  // both already full CRUD over /api/plugins/kanban/*.
  '/kanban': '/tasks',
  '/mcp': '/mcp',
  '/platforms': '/dashboard',
  '/plugins': '/plugins',
  '/skills': '/skills',
}

/**
 * What a catalog command that SwitchUI cannot run tells the user.
 *
 * `POST /api/hermes-commands/exec` now exists (Phase 3), so this is no longer
 * the answer for *every* agent command — only for the ones the server-side
 * allowlist refuses (`server/hermes-slash-policy.ts`). Those are refused for
 * concrete reasons, and the route's own refusal text says which; this notice is
 * the client-side short-circuit for catalog entries whose `runnable` flag is
 * already false, so an unrunnable command costs no round trip.
 *
 * Either way the invariant is unchanged and is the reason this function exists:
 * a catalog-known command NEVER falls through to `sendRef`, because the REST
 * chat path has no slash interpreter and would hand it to the model as prose.
 */
export function agentCommandNotice(command: string, tier: string): string {
  if (tier === 'excluded') {
    return `${command} is not available in SwitchUI`
  }
  if (tier === 'local') {
    // `local` means "SwitchUI should own this" — so reaching this notice means
    // the screen or handler simply hasn't been built, NOT that it is an agent
    // command. Calling it one (as this used to) misreports the reason: e.g.
    // `/toolsets` needs a Toolsets UI, and no amount of Phase-3 exec plumbing
    // would make it work. See §4.2 of the plan for the outstanding set.
    return `${command} isn't built in SwitchUI yet`
  }
  return `${command} is an agent command — running it from SwitchUI isn't wired up yet`
}

export type UseSlashCommandsParams = {
  // Session routing
  navigate: (opts: {
    to: string
    params?: Record<string, string>
    search?: Record<string, unknown>
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

  /**
   * Stream control (from useSendMessageState). `/stop` shares the Stop
   * button's exact handler — including its gateway call — instead of
   * re-implementing it.
   */
  handleAbortStreaming: () => void

  // UI callbacks
  renameSession: (
    sessionKey: string,
    friendlyId: string | null,
    newTitle: string,
  ) => Promise<void>
  /**
   * Branch the current session — resolves to the NEW session's key.
   *
   * Note this is not a plain copy: the gateway ends the source session with
   * `end_reason: "branched"`, which is why the sidebar's equivalent action
   * confirms first. Here the command name itself is the intent, so `/branch`
   * navigates straight to the child.
   */
  forkSession: (sessionKey: string) => Promise<string>

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

  /**
   * The live Hermes command catalog (`useHermesCommandCatalog`). Optional so
   * the hook stays usable without a QueryClient; an absent catalog degrades to
   * today's behaviour, which is exactly what happens when the `agentCommands`
   * capability is off.
   */
  agentCommandCatalog?: HermesCommandCatalog

  /**
   * Put text in the composer without sending it — the `prefill` arm of the
   * `command.dispatch` union (`/undo` returns one). Optional: without it a
   * prefill degrades to a notice rather than silently vanishing.
   *
   * NOT `commandHelpers.setValue`: that object is a module-level no-op stub in
   * `chat-screen.tsx`, kept only to satisfy the send signature.
   */
  setComposerValue?: (value: string) => void
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
    handleAbortStreaming,
    renameSession,
    forkSession,
    sendRef,
    commandHelpers,
    userCommandsPending,
    agentCommandCatalog = EMPTY_HERMES_COMMAND_CATALOG,
    setComposerValue,
  } = params

  const addCommandOutput = useCommandOutputStore((state) => state.addOutput)

  const sessionKeyForCommands =
    forcedSessionKey ||
    resolvedSessionKey ||
    activeSessionKey ||
    activeFriendlyId ||
    ''

  /**
   * Run one agent command through `POST /api/hermes-commands/exec` and route
   * the result union (§5.12).
   *
   * `depth` caps alias re-dispatch at one hop: the agent's `canon` map is
   * flat, so a second hop means either a cycle or a registry change we should
   * not be chasing at runtime.
   */
  const runAgentCommand = useCallback(
    async (command: string, depth = 0): Promise<void> => {
      const outcome = await execAgentCommand({
        command,
        sessionId: sessionKeyForCommands || null,
      })

      if (!outcome.ok) {
        // A refusal is policy, not breakage — it reads as information. A
        // transport failure is an error. Both say why; neither ever falls
        // through to the model.
        toast(outcome.reason, { type: outcome.refused ? 'info' : 'error' })
        return
      }

      const result = outcome.result
      switch (result.type) {
        case 'exec':
        case 'plugin':
          addCommandOutput(sessionKeyForCommands, {
            command: outcome.command,
            output: result.output,
            ...('warning' in result && result.warning
              ? { warning: result.warning }
              : {}),
          })
          return

        case 'send':
        case 'skill': {
          // A skill command is a prompt injection: the agent hands back the
          // skill body and it goes down the ordinary send path, exactly as if
          // the user had pasted it.
          const notice = 'notice' in result ? result.notice : undefined
          if (notice) toast(notice, { type: 'info' })
          if (!result.message.trim()) {
            toast(`${outcome.command} returned nothing to send`, { type: 'info' })
            return
          }
          void sendRef.current?.(result.message, [], false, commandHelpers)
          return
        }

        case 'prefill':
          if (!setComposerValue) {
            toast(
              result.notice ?? `${outcome.command} produced a draft message`,
              { type: 'info' },
            )
            return
          }
          setComposerValue(result.message)
          toast(result.notice ?? `${outcome.command} — review, then send`, {
            type: 'info',
          })
          return

        case 'alias': {
          if (depth >= 1) {
            toast(`${outcome.command} points at another alias — not following`, {
              type: 'error',
            })
            return
          }
          const target = result.target.startsWith('/')
            ? result.target
            : `/${result.target}`
          await runAgentCommand(target, depth + 1)
          return
        }
      }
    },
    [addCommandOutput, commandHelpers, sendRef, sessionKeyForCommands, setComposerValue],
  )

  const handleUiSlashCommand = useCallback(
    (command: string) => {
      const trimmedCommand = command.trim()
      if (!trimmedCommand.startsWith('/')) return false

      // Token + argument split (commands like `/title <name>` carry an arg).
      const [rawToken = '', ...slashArgParts] = trimmedCommand.split(/\s+/)
      const slashArg = slashArgParts.join(' ').trim()
      const slashToken =
        LOCAL_COMMAND_ALIASES[rawToken.toLowerCase()] ?? rawToken.toLowerCase()

      if (slashToken === '/new') {
        // Use the explicit 'new' session sentinel rather than '/chat' alone.
        // The /chat index route redirects to the last-active session via
        // localStorage, so '/new' must route directly to the new sentinel.
        navigate({
          to: '/chat/$sessionKey',
          params: { sessionKey: 'new' },
        })
        return true
      }

      if (slashToken === '/clear') {
        const sessionKey =
          forcedSessionKey ||
          resolvedSessionKey ||
          activeSessionKey ||
          activeFriendlyId
        clearHistoryMessages(queryClient, activeFriendlyId, sessionKey)
        toast('Chat cleared', { type: 'success' })
        return true
      }

      if (slashToken === '/model') {
        if (!slashArg) {
          // Bare `/model` — open the model picker in the meta bar. This
          // used to dispatch CHAT_OPEN_SETTINGS_EVENT, which has zero
          // listeners anywhere in the app (its only would-be handler lives
          // in a hook nothing imports) — a complete no-op. The picker
          // listens for CHAT_OPEN_MODEL_PICKER_EVENT directly.
          window.dispatchEvent(new CustomEvent(CHAT_OPEN_MODEL_PICKER_EVENT))
          return true
        }
        // `/model <id>` — previously fell through every branch below (the
        // exact-string check only matched bare `/model`) and was sent
        // verbatim as chat text over HTTP, which has no slash interpreter.
        // Routes through the same per-session switch as the picker
        // (switchModel persists into useSessionModelStore; see
        // chat-composer-services.ts for why there is no gateway call).
        const sessionKey =
          forcedSessionKey ||
          resolvedSessionKey ||
          activeSessionKey ||
          activeFriendlyId ||
          undefined
        const result = switchModel(slashArg, undefined, sessionKey)
        toast(`Model set: ${result.resolved?.model ?? slashArg}`, {
          type: 'success',
        })
        return true
      }

      // ── §4.3 deep-links ────────────────────────────────────────────────
      // These have richer SwitchUI screens than the agent's 120-column ASCII
      // output, so they are routed rather than proxied. Every target below was
      // verified to exist; the ones with no target are listed at the bottom of
      // this block and deliberately left to the catalog fall-through.
      const settingsSection = SETTINGS_SECTION_COMMANDS[slashToken]
      if (settingsSection !== undefined) {
        // NOT CHAT_OPEN_SETTINGS_EVENT: that event has zero listeners anywhere
        // in the app, so `/skin` has been a silent no-op. The settings screen's
        // own docs say the URL is the only source of truth for the section.
        navigate({
          to: '/settings',
          search: settingsSection ? { section: settingsSection } : {},
        })
        return true
      }

      const deepLinkRoute = DEEP_LINK_ROUTES[slashToken]
      if (deepLinkRoute) {
        navigate({ to: deepLinkRoute })
        return true
      }

      if (slashToken === '/help') {
        // The live catalog IS the help surface (§4.1) — open the picker with
        // everything expanded rather than proxying the agent's ASCII help.
        window.dispatchEvent(new CustomEvent(OPEN_SLASH_COMMAND_MENU_EVENT))
        return true
      }

      if (slashToken === '/branch') {
        const sessionKey =
          forcedSessionKey ||
          resolvedSessionKey ||
          activeSessionKey ||
          activeFriendlyId
        if (!sessionKey) {
          toast('Nothing to branch yet — send a message first', { type: 'info' })
          return true
        }
        void forkSession(sessionKey)
          .then((newSessionKey) => {
            // The gateway ends the source with `end_reason: "branched"`, so say
            // so — "Branched" alone reads as a harmless copy.
            toast('Branched — the original session is now closed', {
              type: 'success',
            })
            navigate({
              to: '/chat/$sessionKey',
              params: { sessionKey: newSessionKey },
            })
          })
          .catch((error: unknown) => {
            toast(error instanceof Error ? error.message : 'Branch failed', {
              type: 'error',
            })
          })
        return true
      }

      if (slashToken === '/copy') {
        // The agent's `/copy` writes an OSC52 terminal escape, which means
        // nothing in a browser — use the clipboard API on the last reply (§4.3).
        const lastReply = [...finalDisplayMessages]
          .reverse()
          .find(
            (message) =>
              message.role === 'assistant' && textFromMessage(message).trim(),
          )
        if (!lastReply) {
          toast('Nothing to copy yet', { type: 'info' })
          return true
        }
        void writeTextToClipboard(textFromMessage(lastReply).trim())
          .then(() => toast('Reply copied', { type: 'success' }))
          .catch(() => toast('Could not copy the reply', { type: 'error' }))
        return true
      }

      if (slashToken === '/save') {
        const exported = exportConversationTranscript({
          sessionLabel: activeFriendlyId || 'conversation',
          messages: finalDisplayMessages,
        })
        if (exported) {
          toast('Conversation exported', { type: 'success' })
        }
        return true
      }

      if (slashToken === '/interrupt') {
        // Reached by `/interrupt` and by the transitional `/stop` alias.
        //
        // Delegates rather than duplicating. This branch used to be a hand
        // copy of handleAbortStreaming (the two drifted apart the moment the
        // gateway call was added to one of them); the TDZ that forced the copy
        // is gone since useSendMessageState was extracted into its own hook,
        // so /interrupt and the Stop button are now literally the same code path.
        //
        // No toast: handleAbortStreaming's stop notice reports what actually
        // happened. "Agent stopped" was a lie the moment it was printed —
        // stop is cooperative and the run may still be unwinding.
        handleAbortStreaming()
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

      // NO `/reasoning` handler. It used to call handleThinkingLevelChange and
      // toast "Reasoning: low" — a success message for a change that cannot
      // reach a turn. The level it set travels as `body.thinking`, which
      // `routes/api/send-stream.ts` deliberately drops because api_server has no
      // per-request effort parameter (`grep -c reasoning_effort` in the
      // installed api_server.py = 0); its only other consumer is the composer's
      // `effectiveFastMode = fastMode && thinkingLevel === 'off'` gate, and
      // `fastMode` is dropped on the same grounds. So both of its downstream
      // paths end in a value the gateway never reads.
      //
      // What actually applies is `agent.reasoning_effort` from config.yaml, and
      // the agent's bare `/reasoning` is the only truthful readout of it —
      // there is no Settings control either. Shadowing that readout with a
      // control that reports success and changes nothing is the defect, not the
      // fix, so the handler is gone and `/reasoning` reaches the exec route.
      // The composer's reasoning picker is untouched; if the gateway ever grows
      // a per-request parameter, wire it there (send-stream.ts says how) rather
      // than reinstating a slash command that duplicates a visible affordance.

      // ── Catalog-known commands ─────────────────────────────────────────
      // Everything the agent advertises but SwitchUI does not handle locally
      // stops here. It must NOT reach `sendRef` — a slash command sent down the
      // chat path is delivered to the model as literal prose (the REST gateway
      // has no slash interpreter at all), which is what made `/mcp` and `/help`
      // dead entries. With a 156-command catalog that failure mode is no longer
      // acceptable, so a catalog hit is always "handled", even when handling it
      // means saying so out loud.
      //
      // Free-typed text that merely starts with `/` is not in the catalog and
      // still falls through to the send path, unchanged.
      const agentCommand = findAgentCommand(agentCommandCatalog, rawToken)
      if (agentCommand) {
        if (agentCommand.runnable) {
          // Fire and forget, same shape as `/branch` above — the command menu
          // must not block on a 5s `/tools`. The server re-checks the allowlist
          // regardless of what this flag says; `runnable` only saves a round
          // trip on commands already known to be refused.
          void runAgentCommand(trimmedCommand)
          return true
        }
        toast(agentCommandNotice(agentCommand.command, agentCommand.tier), {
          type: 'info',
        })
        return true
      }

      return false
    },
    [
      activeFriendlyId,
      activeSessionKey,
      agentCommandCatalog,
      finalDisplayMessages,
      forcedSessionKey,
      forkSession,
      handleAbortStreaming,
      navigate,
      queryClient,
      renameSession,
      resolvedSessionKey,
      runAgentCommand,
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
