/**
 * wiki-focus-store — one-shot hand-off of a wiki page path from the Map tab
 * ("Open in Wiki") to the Wiki tab, which reads it as its initial selection.
 */

import { create } from 'zustand'

type WikiFocusState = {
  path: string | null
  setPath: (path: string | null) => void
}

export const useWikiFocusStore = create<WikiFocusState>()((set) => ({
  path: null,
  setPath: (path) => set({ path }),
}))
