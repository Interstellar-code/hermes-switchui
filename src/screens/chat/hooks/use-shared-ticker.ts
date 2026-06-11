import { useSyncExternalStore } from 'react'

/**
 * Shared ticker (#214): replaces per-card `setInterval` timers.
 *
 * Previously every running ToolCallCard / ThinkingBubble / ToolCallPill spun up
 * its own 1000ms (elapsed) and 400-500ms (dots) interval. A streaming view with
 * many concurrent tool cards therefore ran dozens of independent timers, each
 * forcing its own render and waking the event loop on its own schedule.
 *
 * This module keeps ONE `setInterval` per distinct interval duration, shared by
 * every subscriber via `useSyncExternalStore`. Cards derive their displayed
 * value from `Date.now()` on each tick (see `useSharedTicker` consumers) rather
 * than incrementing a private counter, so a late subscriber stays in sync.
 *
 * The interval is created lazily on first subscription and torn down when the
 * last subscriber for that duration unsubscribes.
 */

type IntervalRegistry = {
  interval: ReturnType<typeof setInterval> | null
  listeners: Set<() => void>
  tick: number
}

const registries = new Map<number, IntervalRegistry>()

function getRegistry(intervalMs: number): IntervalRegistry {
  let registry = registries.get(intervalMs)
  if (!registry) {
    registry = { interval: null, listeners: new Set(), tick: 0 }
    registries.set(intervalMs, registry)
  }
  return registry
}

function subscribe(intervalMs: number, listener: () => void): () => void {
  const registry = getRegistry(intervalMs)
  registry.listeners.add(listener)

  if (registry.interval === null) {
    registry.interval = setInterval(() => {
      registry.tick += 1
      for (const fn of registry.listeners) fn()
    }, intervalMs)
  }

  return () => {
    registry.listeners.delete(listener)
    if (registry.listeners.size === 0 && registry.interval !== null) {
      clearInterval(registry.interval)
      registry.interval = null
    }
  }
}

const serverSnapshot = 0

/**
 * Subscribe to a shared ticker firing every `intervalMs` milliseconds.
 *
 * Returns a monotonically increasing tick count whose only purpose is to
 * re-render the subscriber on each tick. Consumers should compute the value
 * they actually display from `Date.now()` (e.g. elapsed seconds) so the tick
 * count itself carries no meaning beyond "time passed".
 */
export function useSharedTicker(intervalMs: number): number {
  return useSyncExternalStore(
    (listener) => subscribe(intervalMs, listener),
    () => getRegistry(intervalMs).tick,
    () => serverSnapshot,
  )
}
