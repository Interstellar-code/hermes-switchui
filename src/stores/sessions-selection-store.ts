import { create } from 'zustand'

/**
 * Sidebar multi-select (not persisted). Keyed by feed `item.id`.
 * `order` is the visible card order, pushed by the list so shift-click can
 * select a contiguous range.
 */
type SelectionState = {
  active: boolean
  selected: Partial<Record<string, true>>
  anchor: string | null
  order: Array<string>
  /** A bulk-action dialog is open (or running) — Esc must not exit select. */
  dialogOpen: boolean
  enter: () => void
  exit: () => void
  /** Plain click toggles; `range` adds anchor..id over the visible order. */
  click: (id: string, range?: boolean) => void
  setMany: (ids: Array<string>, on: boolean) => void
  setOrder: (ids: Array<string>) => void
  setDialogOpen: (open: boolean) => void
}

export const useSessionsSelectionStore = create<SelectionState>((set) => ({
  active: false,
  selected: {},
  anchor: null,
  order: [],
  dialogOpen: false,
  enter: () => set({ active: true }),
  exit: () =>
    set({ active: false, selected: {}, anchor: null, dialogOpen: false }),
  click: (id, range) =>
    set((s) => {
      const selected = { ...s.selected }
      const a = s.anchor ? s.order.indexOf(s.anchor) : -1
      const b = s.order.indexOf(id)
      if (range && a >= 0 && b >= 0) {
        for (const k of s.order.slice(Math.min(a, b), Math.max(a, b) + 1))
          selected[k] = true
      } else if (selected[id]) delete selected[id]
      else selected[id] = true
      return { active: true, selected, anchor: id }
    }),
  setMany: (ids, on) =>
    set((s) => {
      const selected = { ...s.selected }
      for (const id of ids) {
        if (on) selected[id] = true
        else delete selected[id]
      }
      return { active: true, selected }
    }),
  setOrder: (order) => set({ order }),
  setDialogOpen: (dialogOpen) => set({ dialogOpen }),
}))
