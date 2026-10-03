'use client'

/**
 * sidebar-resize-handle-v2.tsx — drag/keyboard handle on the sessions panel's
 * right edge. During a drag it writes the panel's inline width directly (one
 * rAF per frame, no React render); the store only sees the final width.
 */

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, RefObject } from 'react'

export const SIDEBAR_WIDTH_DEFAULT = 320
export const SIDEBAR_WIDTH_MIN = 260
export const SIDEBAR_WIDTH_MAX = 560

/** Widest allowed panel: 560, or half the viewport, never below 260. */
export function maxSidebarWidth(viewport = Infinity): number {
  return Math.max(
    SIDEBAR_WIDTH_MIN,
    Math.min(SIDEBAR_WIDTH_MAX, Math.floor(viewport / 2)),
  )
}

/**
 * Clamp to [min, max] (and half the viewport when given). Non-finite input —
 * a corrupted persisted value — falls back to the default.
 */
export function clampSidebarWidth(width: number, viewport = Infinity): number {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT
  return Math.round(
    Math.min(maxSidebarWidth(viewport), Math.max(SIDEBAR_WIDTH_MIN, width)),
  )
}

/** Next width for a keyboard key, or null when the key is not ours. */
export function keyboardSidebarWidth(
  key: string,
  shiftKey: boolean,
  width: number,
  viewport: number,
): number | null {
  const step = shiftKey ? 64 : 16
  const next =
    key === 'ArrowRight'
      ? width + step
      : key === 'ArrowLeft'
        ? width - step
        : key === 'Home'
          ? SIDEBAR_WIDTH_MIN
          : key === 'End'
            ? SIDEBAR_WIDTH_MAX
            : null
  return next === null ? null : clampSidebarWidth(next, viewport)
}

export function SidebarResizeHandleV2({
  width,
  onResize,
  panelRef,
}: {
  width: number
  onResize: (width: number) => void
  panelRef: RefObject<HTMLElement | null>
}) {
  const handleRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    startX: number
    startWidth: number
    width: number
    frame: number
  } | null>(null)
  // Viewport-dependent max is read after mount, never during render, so the
  // server and client markup match.
  const [maxWidth, setMaxWidth] = useState(SIDEBAR_WIDTH_MAX)
  useEffect(() => {
    const update = () => setMaxWidth(maxSidebarWidth(window.innerWidth))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  /** Drop drag state and global body styles; returns the drag, if any. */
  function releaseDrag() {
    const current = drag.current
    if (!current) return null
    drag.current = null
    cancelAnimationFrame(current.frame)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    handleRef.current?.removeAttribute('data-dragging')
    return current
  }

  // Unmounting mid-drag (route change, collapse) must not leave the page
  // unselectable with a resize cursor.
  useEffect(() => () => void releaseDrag(), [])

  function endDrag() {
    const current = releaseDrag()
    if (!current) return
    // Flush the last frame so the DOM matches what the store is about to get.
    if (panelRef.current) panelRef.current.style.width = `${current.width}px`
    handleRef.current?.setAttribute('aria-valuenow', String(current.width))
    onResize(current.width)
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const startWidth = panelRef.current?.getBoundingClientRect().width || width
    drag.current = {
      startX: event.clientX,
      startWidth,
      width: clampSidebarWidth(startWidth, window.innerWidth),
      frame: 0,
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    event.currentTarget.setAttribute('data-dragging', '')
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current) return
    current.width = clampSidebarWidth(
      current.startWidth + event.clientX - current.startX,
      window.innerWidth,
    )
    cancelAnimationFrame(current.frame)
    current.frame = requestAnimationFrame(() => {
      if (panelRef.current) panelRef.current.style.width = `${current.width}px`
      handleRef.current?.setAttribute('aria-valuenow', String(current.width))
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = keyboardSidebarWidth(
      event.key,
      event.shiftKey,
      width,
      window.innerWidth,
    )
    if (next === null) return
    event.preventDefault()
    onResize(next)
  }

  return (
    <div
      ref={handleRef}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sessions sidebar"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuemax={maxWidth}
      tabIndex={0}
      data-testid="sessions-panel-resize"
      // Centred on the panel's right border; the parent wraps only the panel.
      className="group absolute inset-y-0 -right-[3px] z-30 w-1.5 cursor-col-resize touch-none outline-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={() => onResize(SIDEBAR_WIDTH_DEFAULT)}
      onKeyDown={onKeyDown}
    >
      <div className="pointer-events-none absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-[var(--theme-border)] transition-colors group-hover:bg-[var(--theme-accent)] group-focus-visible:bg-[var(--theme-accent)] group-data-[dragging]:bg-[var(--theme-accent)]" />
    </div>
  )
}
