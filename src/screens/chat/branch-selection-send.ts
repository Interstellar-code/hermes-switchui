import { createOptimisticMessage } from './chat-screen-utils'
import { stashPendingSend } from './pending-send'
import type { BranchMessageDialogInitial } from './components/branch-message-dialog'
import { useSessionModelStore } from '@/stores/session-model-store'

/**
 * Selection-mode branch (plan `branch-selection`, P1.3).
 *
 * The gateway fork copies whole transcripts; it cannot copy "just a
 * passage". So selection mode never touches /fork: it creates a fresh
 * session, seeds the picked model, stashes the composed first message into
 * the pending-send seam, and navigates — the new session's lifecycle hook
 * (`use-session-lifecycle.ts` useLayoutEffect, keyed on the session keys)
 * consumes the stash, appends the optimistic message and sends.
 */

/** Contract C3: every quote line prefixed `> `, a blank line, then prompt. */
export function composeBranchSelectionMessage(
  quote: string,
  prompt: string,
): string {
  const trimmedQuote = quote.trim()
  const trimmedPrompt = prompt.trim()
  if (!trimmedQuote) return trimmedPrompt
  const quotedLines = trimmedQuote
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  return `${quotedLines}\n\n${trimmedPrompt}`
}

export type BranchSelectionValues = BranchMessageDialogInitial & {
  prompt?: string
}

export type BranchSelectionDeps = {
  /** `createSessionForMessage` — POST /api/sessions → { sessionKey, friendlyId }. */
  createSession: () => Promise<{ sessionKey: string; friendlyId: string }>
  /** Must run BEFORE the send is stashed so the first send carries the model. */
  setSessionModel?: (sessionKey: string, model: string) => void
  createOptimisticMessage?: typeof createOptimisticMessage
  stash?: typeof stashPendingSend
  /** Router navigate to /chat/<friendlyId> — no replace, Back returns to the source. */
  navigate: (opts: {
    to: '/chat/$sessionKey'
    params: { sessionKey: string }
  }) => void
  /** Best-effort title rename; a failure only toasts. */
  renameSession?: (
    sessionKey: string,
    friendlyId: string | null,
    newTitle: string,
  ) => Promise<void>
  toast: (
    message: string,
    opts?: { type?: 'info' | 'success' | 'warning' | 'error' },
  ) => void
  /** Reopen the branch dialog with the user's values after a create failure. */
  onSessionCreateFailed?: (values: BranchSelectionValues) => void
}

export async function branchSelectionToNewSession(
  values: BranchSelectionValues,
  deps: BranchSelectionDeps,
): Promise<void> {
  const body = composeBranchSelectionMessage(
    values.quote ?? '',
    values.prompt ?? '',
  )

  let created: { sessionKey: string; friendlyId: string }
  try {
    created = await deps.createSession()
  } catch (error) {
    deps.toast(
      error instanceof Error ? error.message : 'Could not create the session',
      { type: 'error' },
    )
    deps.onSessionCreateFailed?.(values)
    return
  }

  // Same per-session override the composer picker writes; set BEFORE the
  // send is stashed so the new session's first send carries it.
  if (values.model) {
    const setSessionModel =
      deps.setSessionModel ??
      ((sessionKey: string, model: string) =>
        useSessionModelStore.getState().setModel(sessionKey, model))
    setSessionModel(created.sessionKey, values.model)
  }

  const createOptimistic =
    deps.createOptimisticMessage ?? createOptimisticMessage
  const stash = deps.stash ?? stashPendingSend
  const { optimisticMessage } = createOptimistic(body, [])
  stash({
    sessionKey: created.sessionKey,
    friendlyId: created.friendlyId,
    message: body,
    attachments: [],
    optimisticMessage,
  })
  // No `replace`: Back returns to the source session.
  deps.navigate({
    to: '/chat/$sessionKey',
    params: { sessionKey: created.friendlyId },
  })

  if (values.title) {
    try {
      await deps.renameSession?.(
        created.sessionKey,
        created.friendlyId,
        values.title,
      )
    } catch {
      deps.toast('Branched, but the title could not be saved', {
        type: 'warning',
      })
    }
  }
  deps.toast('Branched selection to new session', { type: 'success' })
}
