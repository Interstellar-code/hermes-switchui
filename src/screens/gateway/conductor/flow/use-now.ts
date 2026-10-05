import { useSyncExternalStore } from 'react'

// One shared 1s ticker for every node that shows a live timer.
const listeners = new Set<() => void>()
let now = Date.now()
let timer: ReturnType<typeof setInterval> | null = null

function subscribe(cb: () => void) {
  listeners.add(cb)
  if (!timer) {
    now = Date.now()
    timer = setInterval(() => {
      now = Date.now()
      for (const l of listeners) l()
    }, 1000)
  }
  return () => {
    listeners.delete(cb)
    if (!listeners.size && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

const noop = () => () => {}
const snapshot = () => now

/** Ticks once a second while `active`; inactive callers get a stable (stale) value. */
export function useNow(active: boolean): number {
  return useSyncExternalStore(active ? subscribe : noop, snapshot, snapshot)
}
