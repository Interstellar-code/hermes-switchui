export type ContextMenuPoint = {
  x: number
  y: number
}

export type ContextMenuSize = {
  width: number
  height: number
}

export type ContextMenuViewport = {
  width: number
  height: number
}

export function clampContextMenuPosition(
  position: ContextMenuPoint,
  menuSize: ContextMenuSize,
  viewport: ContextMenuViewport,
  padding = 8,
): ContextMenuPoint {
  const maxX = Math.max(padding, viewport.width - menuSize.width - padding)
  const maxY = Math.max(padding, viewport.height - menuSize.height - padding)

  return {
    x: Math.min(Math.max(position.x, padding), maxX),
    y: Math.min(Math.max(position.y, padding), maxY),
  }
}
