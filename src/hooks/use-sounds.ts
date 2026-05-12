/**
 * React hook for sound notifications in ClawSuite
 */
import { useCallback, useMemo } from 'react'

import type { SoundEvent } from '@/lib/sounds'

import {
  getSoundVolume,
  isSoundEnabled,
  playAgentComplete,
  playAgentFailed,
  playAgentSpawned,
  playAlert,
  playChatComplete,
  playChatNotification,
  playSound,
  playThinking,
  setSoundEnabled,
  setSoundVolume,
} from '@/lib/sounds'

interface UseSoundsOptions {
  /** Auto-play sounds when agent states change (default: true) */
  autoPlay?: boolean
  /** Throttle thinking sounds to once per interval in ms (default: 2000) */
  thinkingThrottleMs?: number
}

interface UseSoundsReturn {
  // Play functions
  playAgentSpawned: () => void
  playAgentComplete: () => void
  playAgentFailed: () => void
  playChatNotification: () => void
  playChatComplete: () => void
  playAlert: () => void
  playThinking: () => void
  playSound: (event: SoundEvent) => void

  // Control functions
  volume: number
  setVolume: (vol: number) => void
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

/**
 * Hook that provides sound functions and control.
 */
export function useSounds(_options: UseSoundsOptions = {}): UseSoundsReturn {
  const setVolume = useCallback((vol: number) => {
    setSoundVolume(vol)
  }, [])

  const setEnabled = useCallback((enabled: boolean) => {
    setSoundEnabled(enabled)
  }, [])

  return useMemo(
    () => ({
      // Play functions (stable references from module)
      playAgentSpawned,
      playAgentComplete,
      playAgentFailed,
      playChatNotification,
      playChatComplete,
      playAlert,
      playThinking,
      playSound,

      // Control
      volume: getSoundVolume(),
      setVolume,
      enabled: isSoundEnabled(),
      setEnabled,
    }),
    [setVolume, setEnabled],
  )
}

// Re-export types and functions for convenience
export type { SoundEvent }
export {
  playAgentSpawned,
  playAgentComplete,
  playAgentFailed,
  playChatNotification,
  playChatComplete,
  playAlert,
  playThinking,
  setSoundVolume,
  setSoundEnabled,
  isSoundEnabled,
  getSoundVolume,
  playSound,
}
