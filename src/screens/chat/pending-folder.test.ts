// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPendingFolder,
  fileChatInFolder,
  startChatInFolder,
  takePendingFolderForSend,
  useClearPendingFolderOffNewChat,
} from './pending-folder'
import { usePendingFolderStore } from '@/stores/pending-folder-store'

const { bindSessionProject } = vi.hoisted(() => ({
  bindSessionProject: vi.fn(),
}))
vi.mock('@/lib/projects-api', () => ({
  bindSessionProject,
  projectsKeys: { all: ['hermes-projects'] },
}))
const { toast, profile } = vi.hoisted(() => {
  const current: string | null = 'work'
  return { toast: vi.fn(), profile: { current } }
})
vi.mock('@/components/ui/toast', () => ({ toast }))
vi.mock('@/lib/session-scope', () => ({
  getSessionProfile: () => profile.current,
}))

const folder = {
  projectId: 'p1',
  projectSlug: 'alpha',
  name: 'Alpha',
  profile: 'work',
}

beforeEach(() => {
  toast.mockReset()
  profile.current = 'work'
  bindSessionProject.mockReset().mockResolvedValue({})
  usePendingFolderStore.getState().clear()
})

describe('new chat in a folder', () => {
  it('start records the folder and opens /chat/new', () => {
    const navigate = vi.fn()
    startChatInFolder(folder, navigate)
    expect(usePendingFolderStore.getState().pending).toEqual(folder)
    expect(navigate).toHaveBeenCalledWith({
      to: '/chat/$sessionKey',
      params: { sessionKey: 'new' },
    })
  })

  it('without a slug the chat opens unfiled, with a warning', () => {
    const navigate = vi.fn()
    startChatInFolder({ ...folder, projectSlug: undefined }, navigate)
    expect(usePendingFolderStore.getState().pending).toBeNull()
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Alpha'), {
      type: 'warning',
    })
    expect(navigate).toHaveBeenCalled()
  })

  it('the send takes the intent; filing uses that snapshot once', async () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    usePendingFolderStore.getState().set(folder)
    const snapshot = takePendingFolderForSend()
    expect(snapshot).toEqual(folder)
    expect(usePendingFolderStore.getState().pending).toBeNull()
    expect(takePendingFolderForSend()).toBeNull()
    fileChatInFolder(queryClient, 'sess_123', snapshot!)
    expect(bindSessionProject).toHaveBeenCalledTimes(1)
    expect(bindSessionProject).toHaveBeenCalledWith({
      sessionKey: 'sess_123',
      projectSlug: 'alpha',
      profile: 'work',
    })
    await vi.waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['hermes-projects'],
      }),
    )
  })

  it('a profile change since "+" drops the intent and says so', () => {
    usePendingFolderStore.getState().set(folder)
    profile.current = 'other'
    expect(takePendingFolderForSend()).toBeNull()
    expect(usePendingFolderStore.getState().pending).toBeNull()
    expect(toast).toHaveBeenCalledWith(
      'Not filed in Alpha: the profile changed.',
      {
        type: 'info',
      },
    )
  })

  it('a plain "New chat" clears the intent', () => {
    usePendingFolderStore.getState().set(folder)
    clearPendingFolder()
    expect(usePendingFolderStore.getState().pending).toBeNull()
  })

  it('leaving after the send started does not touch that send', () => {
    usePendingFolderStore.getState().set(folder)
    const snapshot = takePendingFolderForSend()
    const { unmount } = renderHook(() => useClearPendingFolderOffNewChat(true))
    unmount()
    fileChatInFolder(new QueryClient(), 'sess_9', snapshot!)
    expect(bindSessionProject).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: 'sess_9', projectSlug: 'alpha' }),
    )
  })

  it('leaving the new chat without sending clears the intent', () => {
    usePendingFolderStore.getState().set(folder)
    const { rerender } = renderHook(
      ({ isNew }: { isNew: boolean }) => useClearPendingFolderOffNewChat(isNew),
      { initialProps: { isNew: true } },
    )
    expect(usePendingFolderStore.getState().pending).toEqual(folder)
    rerender({ isNew: false })
    expect(usePendingFolderStore.getState().pending).toBeNull()
  })
})
