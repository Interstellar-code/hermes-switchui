/**
 * sidebar-flag.ts — feature flag for the v2 unified sessions sidebar.
 *
 * Set VITE_HERMES_SIDEBAR_V2=true in your .env to enable.
 * Falls back to false when unset.
 */

export function useSidebarV2Flag(): boolean {
  return import.meta.env.VITE_HERMES_SIDEBAR_V2 === 'true'
}
