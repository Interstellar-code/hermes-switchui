import { useEffect } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { PendingFolder } from '@/stores/pending-folder-store'
import { bindSessionProject, projectsKeys } from '@/lib/projects-api'
import { getSessionProfile } from '@/lib/session-scope'
import { toast } from '@/components/ui/toast'
import { usePendingFolderStore } from '@/stores/pending-folder-store'

type NewChatNavigate = (opts: {
  to: '/chat/$sessionKey'
  params: { sessionKey: string }
}) => unknown

/**
 * Record the folder for the next new chat and open `/chat/new`. Without a
 * project slug there is nothing to bind to: the chat still opens, unfiled.
 */
export function startChatInFolder(
  folder: Omit<PendingFolder, 'projectSlug'> & { projectSlug?: string | null },
  navigate: NewChatNavigate,
): void {
  const { projectSlug } = folder
  if (projectSlug)
    usePendingFolderStore.getState().set({ ...folder, projectSlug })
  else {
    usePendingFolderStore.getState().clear()
    toast(
      `Couldn't find ${folder.name}'s project — the new chat won't be filed.`,
      {
        type: 'warning',
      },
    )
  }
  void navigate({ to: '/chat/$sessionKey', params: { sessionKey: 'new' } })
}

/** A plain "New chat" (not from a folder) is not filed anywhere. */
export function clearPendingFolder(): void {
  usePendingFolderStore.getState().clear()
}

/**
 * The first send of a new chat starts: take the folder intent off the store
 * and return it as this send's snapshot (null when there is none, or when the
 * browsed profile changed since it was recorded — the user is told). From
 * here on the intent belongs to the send, so leaving the page or picking
 * another folder can no longer change where THIS chat is filed.
 */
export function takePendingFolderForSend(): PendingFolder | null {
  const { pending, clear } = usePendingFolderStore.getState()
  if (!pending) return null
  clear()
  if (pending.profile !== getSessionProfile()) {
    toast(`Not filed in ${pending.name}: the profile changed.`, {
      type: 'info',
    })
    return null
  }
  return pending
}

/** Bind a just-created session to the folder snapshotted at send time. */
export function fileChatInFolder(
  queryClient: QueryClient,
  sessionKey: string,
  folder: PendingFolder,
): void {
  void bindSessionProject({
    sessionKey,
    projectSlug: folder.projectSlug,
    profile: folder.profile ?? undefined,
  })
    .then(() => queryClient.invalidateQueries({ queryKey: projectsKeys.all }))
    .catch((err: unknown) => {
      toast(
        `Couldn't file the chat in ${folder.name}: ${err instanceof Error ? err.message : String(err)}`,
        { type: 'error' },
      )
    })
}

/** Leaving the new chat before sending drops the (unsent) intent. */
export function useClearPendingFolderOffNewChat(isNewChat: boolean): void {
  useEffect(() => {
    if (!isNewChat) return
    return () => usePendingFolderStore.getState().clear()
  }, [isNewChat])
}
