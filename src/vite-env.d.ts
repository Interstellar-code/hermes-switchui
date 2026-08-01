/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  /** Gate the workflow "Modified factory" provenance badge (DB-as-SoT migration). */
  readonly VITE_WORKFLOW_PROVENANCE_V3?: string
}

type HermesDesktopUpdateState = {
  checking: boolean
  available: boolean
  downloaded: boolean
  error: string | null
  version: string
  latestVersion?: string | null
}

interface Window {
  hermesDesktop?: {
    updates: {
      check: () => Promise<{ ok: boolean; error?: string }>
      getState: () => Promise<HermesDesktopUpdateState>
      onStateChange: (
        callback: (state: HermesDesktopUpdateState) => void,
      ) => void
      removeStateListener: (
        callback: (state: HermesDesktopUpdateState) => void,
      ) => void
      download: () => Promise<{ ok: boolean; error?: string }>
      install: () => Promise<{ ok: boolean; error?: string }>
    }
    app: { version: string; platform: string; isElectron: true }
  }
}
