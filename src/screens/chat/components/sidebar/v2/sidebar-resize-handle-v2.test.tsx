// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SidebarResizeHandleV2,
  clampSidebarWidth,
  keyboardSidebarWidth,
} from './sidebar-resize-handle-v2'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('clampSidebarWidth', () => {
  it('clamps to 260..560 on a wide viewport', () => {
    expect(clampSidebarWidth(100, 1440)).toBe(260)
    expect(clampSidebarWidth(480, 1440)).toBe(480)
    expect(clampSidebarWidth(900, 1440)).toBe(560)
  })

  it('caps at half the viewport but never below the minimum', () => {
    expect(clampSidebarWidth(560, 800)).toBe(400)
    expect(clampSidebarWidth(560, 400)).toBe(260)
  })

  it('falls back to 320 for non-finite input', () => {
    expect(clampSidebarWidth(NaN)).toBe(320)
    expect(clampSidebarWidth(Infinity)).toBe(320)
    expect(clampSidebarWidth(900)).toBe(560)
  })
})

describe('keyboardSidebarWidth', () => {
  it('steps 16px, 64px with shift, Home/End to the limits', () => {
    expect(keyboardSidebarWidth('ArrowRight', false, 320, 1440)).toBe(336)
    expect(keyboardSidebarWidth('ArrowLeft', false, 320, 1440)).toBe(304)
    expect(keyboardSidebarWidth('ArrowRight', true, 320, 1440)).toBe(384)
    expect(keyboardSidebarWidth('ArrowLeft', true, 300, 1440)).toBe(260)
    expect(keyboardSidebarWidth('Home', false, 400, 1440)).toBe(260)
    expect(keyboardSidebarWidth('End', false, 400, 1440)).toBe(560)
    expect(keyboardSidebarWidth('Enter', false, 400, 1440)).toBeNull()
  })
})

describe('SidebarResizeHandleV2', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const onResize = vi.fn()

  beforeEach(() => {
    onResize.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(
        <SidebarResizeHandleV2
          width={400}
          onResize={onResize}
          panelRef={createRef<HTMLElement>()}
        />,
      )
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const handle = () =>
    container.querySelector<HTMLElement>('[role="separator"]')!

  it('exposes separator aria attributes', () => {
    const el = handle()
    expect(el.getAttribute('aria-orientation')).toBe('vertical')
    expect(el.getAttribute('aria-label')).toBe('Resize sessions sidebar')
    expect(el.getAttribute('aria-valuenow')).toBe('400')
    expect(el.getAttribute('aria-valuemin')).toBe('260')
    expect(el.getAttribute('aria-valuemax')).toBeTruthy()
    expect(el.tabIndex).toBe(0)
  })

  it('double-click resets to 320', () => {
    act(() => {
      handle().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(onResize).toHaveBeenCalledWith(320)
  })

  it('ArrowRight grows by 16px', () => {
    act(() => {
      handle().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      )
    })
    expect(onResize).toHaveBeenCalledWith(416)
  })

  it('unmounting mid-drag restores body styles without committing', () => {
    const el = handle()
    el.setPointerCapture = vi.fn()
    act(() => {
      el.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
      )
    })
    expect(document.body.style.userSelect).toBe('none')
    expect(document.body.style.cursor).toBe('col-resize')
    act(() => root.render(<></>))
    expect(document.body.style.userSelect).toBe('')
    expect(document.body.style.cursor).toBe('')
    expect(onResize).not.toHaveBeenCalled()
  })
})
