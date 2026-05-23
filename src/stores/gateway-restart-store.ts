import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type GatewayRestartState = {
  needsRestart: boolean
  profileName: string | null
  since: number | null
  markNeedsRestart: (profileName: string) => void
  dismiss: () => void
}

export const useGatewayRestartStore = create<GatewayRestartState>()(
  persist(
    (set) => ({
      needsRestart: false,
      profileName: null,
      since: null,
      markNeedsRestart: (profileName) =>
        set({ needsRestart: true, profileName, since: Date.now() }),
      dismiss: () =>
        set({ needsRestart: false, profileName: null, since: null }),
    }),
    {
      name: 'hermes-gateway-restart',
      version: 1,
    },
  ),
)
