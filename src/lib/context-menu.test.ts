import { describe, expect, it } from 'vitest'
import { clampContextMenuPosition } from './context-menu'

describe('clampContextMenuPosition', () => {
  it('keeps on-screen positions unchanged', () => {
    expect(
      clampContextMenuPosition(
        { x: 120, y: 90 },
        { width: 180, height: 140 },
        { width: 1280, height: 720 },
      ),
    ).toEqual({ x: 120, y: 90 })
  })

  it('clamps overflowing positions to the viewport edge', () => {
    expect(
      clampContextMenuPosition(
        { x: 1260, y: 700 },
        { width: 180, height: 140 },
        { width: 1280, height: 720 },
      ),
    ).toEqual({ x: 1092, y: 572 })
  })

  it('respects the minimum padding', () => {
    expect(
      clampContextMenuPosition(
        { x: -40, y: -10 },
        { width: 180, height: 140 },
        { width: 1280, height: 720 },
      ),
    ).toEqual({ x: 8, y: 8 })
  })

  it('falls back to padding when the viewport is smaller than the menu', () => {
    expect(
      clampContextMenuPosition(
        { x: 40, y: 50 },
        { width: 300, height: 280 },
        { width: 200, height: 180 },
      ),
    ).toEqual({ x: 8, y: 8 })
  })
})
