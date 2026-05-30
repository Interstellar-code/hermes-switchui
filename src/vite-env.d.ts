/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  /** Gate the workflow "Modified factory" provenance badge (DB-as-SoT migration). */
  readonly VITE_WORKFLOW_PROVENANCE_V3?: string
}
