import { useCallback, useEffect, useState } from 'react'
import type { RefObject } from 'react'

import type { ChatComposerHandle } from '../components/chat-composer-types'
import { SEARCH_MODAL_EVENTS } from '@/hooks/use-search-modal'
import { SIDEBAR_TOGGLE_EVENT } from '@/hooks/use-global-shortcuts'
import { useWorkspaceStore } from '@/stores/workspace-store'

export function useFocusMode(params: {
  compact: boolean
  composerHandleRef: RefObject<ChatComposerHandle | null>
}): {
  chatFocusMode: boolean
  isFocusMode: boolean
  fileExplorerCollapsed: boolean
  handleToggleFocusMode: () => void
  handleToggleSidebarCollapse: () => void
  handleToggleFileExplorer: () => void
  handleInsertFileReference: (reference: string) => void
  handleAttachWorkspaceImage: (path: string) => Promise<void>
  handleAttachWorkspaceFile: (path: string) => Promise<void>
} {
  const { compact, composerHandleRef } = params

  const chatFocusMode = useWorkspaceStore((s) => s.chatFocusMode)
  const setChatFocusMode = useWorkspaceStore((s) => s.setChatFocusMode)
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar)

  const [fileExplorerCollapsed, setFileExplorerCollapsed] = useState(() => {
    if (typeof window === 'undefined') return true
    const stored = localStorage.getItem('claude-file-explorer-collapsed')
    return stored === null ? true : stored === 'true'
  })

  const isFocusMode = !compact && chatFocusMode

  const handleToggleFocusMode = useCallback(() => {
    if (compact) return
    setChatFocusMode(!chatFocusMode)
  }, [chatFocusMode, compact, setChatFocusMode])

  // E31: auto-collapse focus mode when compact changes
  useEffect(() => {
    if (compact && chatFocusMode) {
      setChatFocusMode(false)
    }
  }, [chatFocusMode, compact, setChatFocusMode])

  // E32: Escape key exits focus mode
  useEffect(() => {
    if (!chatFocusMode) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      setChatFocusMode(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [chatFocusMode, setChatFocusMode])

  // E33: ⌘. (Mac) / Ctrl+. (Win) to toggle focus mode
  useEffect(() => {
    if (compact) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '.' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      setChatFocusMode(!chatFocusMode)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [compact, chatFocusMode, setChatFocusMode])

  // E34: unmount reset — reads store via getState() so deps stay []
  useEffect(() => {
    return () => {
      useWorkspaceStore.getState().setChatFocusMode(false)
    }
  }, [])

  const handleToggleSidebarCollapse = useCallback(() => {
    toggleSidebar()
  }, [toggleSidebar])

  const handleToggleFileExplorer = useCallback(() => {
    setFileExplorerCollapsed((prev) => {
      const next = !prev
      if (typeof window !== 'undefined') {
        localStorage.setItem('claude-file-explorer-collapsed', String(next))
      }
      return next
    })
  }, [])

  // Window toggle events — wires custom events to the handlers
  useEffect(() => {
    function handleToggleFileExplorerFromSearch() {
      handleToggleFileExplorer()
    }

    window.addEventListener(
      SEARCH_MODAL_EVENTS.TOGGLE_FILE_EXPLORER,
      handleToggleFileExplorerFromSearch,
    )
    window.addEventListener(SIDEBAR_TOGGLE_EVENT, handleToggleSidebarCollapse)
    return () => {
      window.removeEventListener(
        SEARCH_MODAL_EVENTS.TOGGLE_FILE_EXPLORER,
        handleToggleFileExplorerFromSearch,
      )
      window.removeEventListener(
        SIDEBAR_TOGGLE_EVENT,
        handleToggleSidebarCollapse,
      )
    }
  }, [handleToggleFileExplorer, handleToggleSidebarCollapse])

  const handleInsertFileReference = useCallback((reference: string) => {
    composerHandleRef.current?.insertText(reference)
  }, [])

  const handleAttachWorkspaceImage = useCallback(
    async (path: string) => {
      const composer = composerHandleRef.current
      if (!composer) throw new Error('Chat composer is unavailable')

      const res = await fetch(
        `/api/files?action=read&path=${encodeURIComponent(path)}`,
      )
      if (!res.ok) throw new Error(`Could not read image (HTTP ${res.status})`)
      const data = (await res.json()) as { type?: string; content?: string }
      if (data.type !== 'image' || !data.content) {
        throw new Error('This workspace file is not an image')
      }

      const imageResponse = await fetch(data.content)
      if (!imageResponse.ok) throw new Error('Could not prepare image attachment')
      const blob = await imageResponse.blob()
      const name = path.split('/').filter(Boolean).pop() || 'workspace-image'
      await composer.addFiles([
        new File([blob], name, { type: blob.type || 'image/*' }),
      ])
    },
    [composerHandleRef],
  )

  const handleAttachWorkspaceFile = useCallback(
    async (path: string) => {
      const composer = composerHandleRef.current
      if (!composer) throw new Error('Chat composer is unavailable')

      const res = await fetch(
        `/api/files?action=download&path=${encodeURIComponent(path)}`,
      )
      if (!res.ok) throw new Error(`Could not read file (HTTP ${res.status})`)
      const blob = await res.blob()
      const name = path.split('/').filter(Boolean).pop() || 'workspace-file'
      await composer.addFiles([
        new File([blob], name, {
          type: blob.type || 'application/octet-stream',
        }),
      ])
    },
    [composerHandleRef],
  )

  return {
    chatFocusMode,
    isFocusMode,
    fileExplorerCollapsed,
    handleToggleFocusMode,
    handleToggleSidebarCollapse,
    handleToggleFileExplorer,
    handleInsertFileReference,
    handleAttachWorkspaceImage,
    handleAttachWorkspaceFile,
  }
}
