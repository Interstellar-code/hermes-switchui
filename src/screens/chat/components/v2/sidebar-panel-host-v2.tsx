import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Dialog } from '@base-ui/react/dialog'
import { PANEL_TITLES, SidebarPanelV2 } from './sidebar-panel-v2'
import type { ReactNode } from 'react'
import type { SidebarPanel, SidebarPanelV2Props } from './sidebar-panel-v2'
import { useSearchModal } from '@/hooks/use-search-modal'

const OVERLAY_CLASS =
  'absolute inset-0 z-20 m-2 flex flex-col overflow-hidden rounded-md border'
const SHELL_SELECTOR = '[data-testid="sidebar-shell-v2"]'

type SidebarPanelHostV2Props = Omit<
  SidebarPanelV2Props,
  'panel' | 'onClose'
> & {
  activePanel: SidebarPanel | null
  onClose: () => void
  /** False on mobile and in focus mode, where no sessions sidebar is shown. */
  sidebarAvailable: boolean
  /** The file explorer element, shown for the `files` panel. */
  fileExplorer: ReactNode
}

/** Esc belongs to whatever is under the user's hands, not the panel. */
function escBelongsElsewhere(target: EventTarget | null): boolean {
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed) return true // quote bubble
  // Open menu: only one that is rendered (closed menus may stay mounted
  // hidden, display:none or inert).
  for (const menu of document.querySelectorAll('[role="menu"]')) {
    if (menu.getClientRects().length > 0 && !menu.closest('[inert]'))
      return true
  }
  if (!(target instanceof HTMLElement)) return false
  return Boolean(
    target.isContentEditable ||
    target.matches('input, textarea, select') ||
    target.closest(
      '[role="menu"], [role="listbox"], [role="menuitem"], [role="dialog"]:not([data-sidebar-panel-sheet])',
    ),
  )
}

/**
 * Places the active sidebar panel. Panels overlay the sessions-sidebar
 * footprint by portalling into the sidebar-shell-v2 node, so they follow the
 * resizable sidebar width with zero coordinate math. Without a sidebar node
 * content panels open as a modal sheet; the file explorer has no sheet.
 */
export function SidebarPanelHostV2({
  activePanel,
  onClose,
  sidebarAvailable,
  fileExplorer,
  ...panelProps
}: SidebarPanelHostV2Props) {
  const [filesMounted, setFilesMounted] = useState(false)
  // undefined = not looked up yet (render neither portal nor sheet).
  const [sidebarNode, setSidebarNode] = useState<HTMLElement | null>()
  const wantsNode = sidebarAvailable && (activePanel !== null || filesMounted)
  // No deps on purpose: re-query after every commit while the node is missing
  // or detached (the shell is a WorkspaceShell sibling that remounts).
  useLayoutEffect(() => {
    if (!wantsNode || sidebarNode?.isConnected) return
    const found = document.querySelector<HTMLElement>(SHELL_SELECTOR)
    if (found !== sidebarNode) setSidebarNode(found)
  })
  const portalNode =
    sidebarAvailable && sidebarNode?.isConnected ? sidebarNode : null

  if (activePanel === 'files' && portalNode && !filesMounted) {
    setFilesMounted(true)
  }
  const contentPanel = activePanel === 'files' ? null : activePanel
  const sheetPanel =
    contentPanel &&
    !portalNode &&
    (!sidebarAvailable || sidebarNode !== undefined)
      ? contentPanel
      : null
  const panelVisible =
    sheetPanel !== null || (activePanel !== null && portalNode !== null)

  // Esc closes the open panel. Capture phase so it runs first; preventDefault
  // tells focus mode (which skips defaultPrevented) not to exit too. No
  // stopPropagation: menus and other Esc listeners still see the key.
  useEffect(() => {
    if (!panelVisible) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (escBelongsElsewhere(event.target)) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [panelVisible, onClose])

  // The search modal (z-50) sits below the sheet (z-80); close the sheet.
  const searchOpen = useSearchModal((s) => s.isOpen)
  useEffect(() => {
    if (searchOpen && sheetPanel) onClose()
  }, [searchOpen, sheetPanel, onClose])

  // Sidebar panels: when one closes and focus was lost with it, return focus
  // to its toggle. (The sheet returns focus itself.)
  const prevPortalPanel = useRef<SidebarPanel | null>(null)
  useEffect(() => {
    const prev = prevPortalPanel.current
    prevPortalPanel.current = portalNode ? activePanel : null
    if (!prev || prev === activePanel) return
    const focused = document.activeElement
    if (focused && focused !== document.body && !focused.closest('[inert]'))
      return
    document
      .querySelector<HTMLElement>(
        `[aria-label="Sidebar panels"] [data-panel="${prev}"]`,
      )
      ?.focus()
  }, [activePanel, portalNode])

  return (
    <>
      {portalNode && filesMounted
        ? createPortal(
            <div
              id={activePanel === 'files' ? 'chat-sidebar-panel' : undefined}
              className={
                activePanel === 'files'
                  ? `${OVERLAY_CLASS} transition-opacity duration-150`
                  : `${OVERLAY_CLASS} pointer-events-none opacity-0 transition-opacity duration-150`
              }
              style={{
                borderColor: 'var(--theme-border)',
                background: 'var(--theme-sidebar)',
              }}
              inert={activePanel !== 'files'}
            >
              {fileExplorer}
            </div>,
            portalNode,
          )
        : null}
      {contentPanel && portalNode
        ? createPortal(
            <div
              className={OVERLAY_CLASS}
              style={{ borderColor: 'var(--theme-border)' }}
            >
              <SidebarPanelV2
                {...panelProps}
                panel={contentPanel}
                onClose={onClose}
              />
            </div>,
            portalNode,
          )
        : null}
      {/* Modal sheet: portalled to body (outside the chat grid), focus trap,
          outside content inert, focus returned on close. z-[80] clears the
          mobile composer (fixed, z-70). */}
      <Dialog.Root
        open={sheetPanel !== null}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      >
        <Dialog.Portal>
          <Dialog.Popup
            data-sidebar-panel-sheet=""
            aria-label={sheetPanel ? PANEL_TITLES[sheetPanel] : undefined}
            className="fixed inset-0 z-[80] flex flex-col"
            style={{ background: 'var(--theme-bg)' }}
          >
            {sheetPanel ? (
              <SidebarPanelV2
                {...panelProps}
                panel={sheetPanel}
                onClose={onClose}
              />
            ) : null}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
