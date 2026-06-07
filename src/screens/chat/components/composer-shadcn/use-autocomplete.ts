import * as React from 'react'

import {
  MOCK_COMMANDS,
  MOCK_MENTIONS,
  type AutocompleteItem,
} from './mock-data'

// Trigger characters supported by the composer autocomplete.
export type TriggerMode = '/' | '@'

type AutocompleteState = {
  isOpen: boolean
  triggerMode: TriggerMode | null
  query: string
  triggerStart: number
  selectedIndex: number
  filteredItems: AutocompleteItem[]
}

const INITIAL_STATE: AutocompleteState = {
  isOpen: false,
  triggerMode: null,
  query: '',
  triggerStart: -1,
  selectedIndex: 0,
  filteredItems: [],
}

function itemsForMode(mode: TriggerMode): AutocompleteItem[] {
  return mode === '/' ? MOCK_COMMANDS : MOCK_MENTIONS
}

function filterItems(items: AutocompleteItem[], query: string): AutocompleteItem[] {
  const q = query.trim().toLowerCase()
  if (!q) {
    return items
  }
  return items.filter((it) => it.label.toLowerCase().includes(q))
}

// Walk backwards from the cursor to find an active "/" or "@" trigger.
function detectTrigger(
  value: string,
  cursorPos: number,
): { mode: TriggerMode; start: number; query: string } | null {
  let i = cursorPos - 1
  while (i >= 0) {
    const ch = value[i]
    if (ch === ' ' || ch === '\n' || ch === '\r') {
      return null
    }
    if (ch === '/' || ch === '@') {
      // Trigger must be at start of input or preceded by whitespace.
      if (i === 0 || value[i - 1] === ' ' || value[i - 1] === '\n') {
        return { mode: ch as TriggerMode, start: i, query: value.slice(i + 1, cursorPos) }
      }
      return null
    }
    i--
  }
  return null
}

export type UseAutocompleteResult = {
  isOpen: boolean
  triggerMode: TriggerMode | null
  filteredItems: AutocompleteItem[]
  selectedIndex: number
  /** Recompute trigger state from the current input value + caret position. */
  sync: (value: string, cursorPos: number) => void
  /** Returns true if the key was consumed (caller should stopPropagation/preventDefault). */
  handleKeyDown: (e: React.KeyboardEvent) => boolean
  /** Apply the item at index to the input, returning the new value + caret. */
  applySelection: (
    index: number,
    value: string,
  ) => { value: string; cursor: number } | null
  dismiss: () => void
}

export function useAutocomplete(): UseAutocompleteResult {
  const [state, setState] = React.useState<AutocompleteState>(INITIAL_STATE)

  const sync = React.useCallback((value: string, cursorPos: number) => {
    const trigger = detectTrigger(value, cursorPos)
    if (!trigger) {
      setState((prev) => (prev.isOpen ? INITIAL_STATE : prev))
      return
    }
    const items = itemsForMode(trigger.mode)
    const filtered = filterItems(items, trigger.query)
    setState((prev) => ({
      isOpen: true,
      triggerMode: trigger.mode,
      query: trigger.query,
      triggerStart: trigger.start,
      filteredItems: filtered,
      selectedIndex: Math.min(prev.selectedIndex, Math.max(0, filtered.length - 1)),
    }))
  }, [])

  const applySelection = React.useCallback(
    (index: number, value: string): { value: string; cursor: number } | null => {
      const item = state.filteredItems[index]
      if (!item || state.triggerStart < 0) {
        return null
      }
      const before = value.slice(0, state.triggerStart)
      const after = value.slice(state.triggerStart + 1 + state.query.length)
      // item.label already includes the leading trigger char (e.g. "/clear").
      const inserted = `${item.label} `
      const nextValue = before + inserted + after
      const cursor = before.length + inserted.length
      setState(INITIAL_STATE)
      return { value: nextValue, cursor }
    },
    [state.filteredItems, state.triggerStart, state.query.length],
  )

  const dismiss = React.useCallback(() => setState(INITIAL_STATE), [])

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!state.isOpen || state.filteredItems.length === 0) {
        return false
      }
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setState((prev) => ({
            ...prev,
            selectedIndex: (prev.selectedIndex + 1) % prev.filteredItems.length,
          }))
          return true
        case 'ArrowUp':
          e.preventDefault()
          setState((prev) => ({
            ...prev,
            selectedIndex:
              (prev.selectedIndex - 1 + prev.filteredItems.length) %
              prev.filteredItems.length,
          }))
          return true
        case 'Enter':
        case 'Tab':
          // Selection is applied by the caller (it owns the input value).
          e.preventDefault()
          return true
        case 'Escape':
          e.preventDefault()
          setState(INITIAL_STATE)
          return true
        default:
          return false
      }
    },
    [state.isOpen, state.filteredItems.length],
  )

  return {
    isOpen: state.isOpen,
    triggerMode: state.triggerMode,
    filteredItems: state.filteredItems,
    selectedIndex: state.selectedIndex,
    sync,
    handleKeyDown,
    applySelection,
    dismiss,
  }
}
