export type ProductId = 'workspace' | 'agent'

export type ProductUpdateStatus = {
  id: ProductId
  label: string
  installKind: 'git' | 'desktop' | 'docker' | 'unknown'
  version: string
  targetVersion?: string | null
  path: string | null
  repoPath: string | null
  branch: string | null
  currentHead: string | null
  latestHead: string | null
  updateAvailable: boolean
  canUpdate: boolean
  state: 'current' | 'available' | 'blocked' | 'unsupported' | 'error'
  reason: string | null
  blockingFiles?: Array<string>
  updateMode: string
}

export type ReleaseNoteSection = {
  product: ProductId
  label: string
  from: string | null
  to: string | null
  commits: Array<string>
}

export type UpdateStatus = {
  ok: true
  checkedAt: number
  products: Record<ProductId, ProductUpdateStatus>
  updateAvailable: boolean
  pendingReleaseNotes?: Array<ReleaseNoteSection>
}

export type ApplyUpdateResult = {
  ok: boolean
  product: ProductId
  output?: string
  restartRequired?: boolean
  status?: ProductUpdateStatus
  releaseNotes?: Array<ReleaseNoteSection>
  error?: string
}

export const UPDATE_STATUS_QUERY_KEY = ['update-status-v2'] as const

export function shortSha(value: string | null | undefined): string {
  return value ? value.slice(0, 7) : 'unknown'
}

/** The version the update moves *to* — a tag for desktop, a SHA for git. */
export function productVersionLabel(product: ProductUpdateStatus): string {
  return product.installKind === 'desktop'
    ? (product.targetVersion ?? product.version)
    : shortSha(product.latestHead)
}

/**
 * Copy for the pre-update confirmation, shared by the Update Center popup and
 * Settings → Updates so both describe the same action the same way.
 *
 * The consequence line matters more than the version pair: a workspace update
 * rebuilds and needs a restart, and an Agent update restarts the gateway —
 * neither is obvious from "8ade871 → f43cec1".
 */
export function updateConfirmOptions(product: ProductUpdateStatus): {
  title: string
  message: string
  confirmLabel: string
} {
  const from =
    product.installKind === 'desktop'
      ? product.version
      : shortSha(product.currentHead)
  const to = productVersionLabel(product)
  const consequence =
    product.updateMode === 'desktop-install-ready'
      ? 'The app will install the downloaded update and restart.'
      : product.installKind === 'desktop'
        ? 'The update downloads in the background; you install it afterwards.'
        : product.id === 'agent'
          ? 'Hermes applies the update, refreshes dependencies, and restarts the gateway. Running sessions will be interrupted.'
          : 'The checkout is fast-forwarded and rebuilt. A restart is required afterwards.'
  return {
    title: `Update ${product.label}?`,
    message: `${from} → ${to}. ${consequence}`,
    confirmLabel:
      product.updateMode === 'desktop-install-ready'
        ? 'Install & restart'
        : product.installKind === 'desktop'
          ? 'Download'
          : 'Update',
  }
}

function desktopWorkspaceStatus(
  state: HermesDesktopUpdateState,
): ProductUpdateStatus {
  return {
    id: 'workspace',
    label: 'Hermes Switch UI',
    installKind: 'desktop',
    version: state.version,
    targetVersion: state.latestVersion,
    path: null,
    repoPath: null,
    branch: null,
    currentHead: null,
    latestHead: null,
    updateAvailable: state.available,
    canUpdate: state.available,
    state: state.error ? 'error' : state.available ? 'available' : 'current',
    reason: state.error,
    updateMode: state.downloaded
      ? 'desktop-install-ready'
      : 'desktop-auto-updater',
  }
}

export function mergeDesktopUpdateState(
  status: UpdateStatus,
  state: HermesDesktopUpdateState,
): UpdateStatus {
  const workspace = desktopWorkspaceStatus(state)
  return {
    ...status,
    checkedAt: Date.now(),
    products: { ...status.products, workspace },
    updateAvailable:
      workspace.updateAvailable || status.products.agent.updateAvailable,
  }
}

export function subscribeDesktopUpdates(
  callback: (state: HermesDesktopUpdateState) => void,
): () => void {
  const updates = window.hermesDesktop?.updates
  if (!updates) return () => undefined
  updates.onStateChange(callback)
  return () => updates.removeStateListener(callback)
}

export async function applyDesktopWorkspaceUpdate(): Promise<ApplyUpdateResult> {
  const updates = window.hermesDesktop?.updates
  if (!updates)
    return {
      ok: false,
      product: 'workspace',
      error: 'Desktop updater unavailable',
    }
  const state = await updates.getState()
  const result = state.downloaded
    ? await updates.install()
    : await updates.download()
  return {
    ok: result.ok,
    product: 'workspace',
    output: state.downloaded ? 'installing' : 'downloaded',
    restartRequired: state.downloaded,
    error: result.error,
  }
}

export async function fetchUpdateStatus(): Promise<UpdateStatus> {
  const response = await fetch('/api/update/status')
  if (!response.ok) throw new Error('Unable to check for updates')
  const status = (await response.json()) as UpdateStatus
  const updates = window.hermesDesktop?.updates
  if (!updates) return status
  await updates.check()
  return mergeDesktopUpdateState(status, await updates.getState())
}
