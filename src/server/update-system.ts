import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { dashboardFetch } from './gateway-capabilities'

type ProductId = 'workspace' | 'agent'
type InstallKind = 'git' | 'desktop' | 'docker' | 'unknown'
type UpdateState = 'current' | 'available' | 'blocked' | 'unsupported' | 'error'

type ReleaseNoteSection = {
  product: ProductId
  label: string
  from: string | null
  to: string | null
  commits: Array<string>
}

export type ProductUpdateStatus = {
  id: ProductId
  label: string
  installKind: InstallKind
  version: string
  path: string | null
  repoPath: string | null
  branch: string | null
  currentHead: string | null
  latestHead: string | null
  updateAvailable: boolean
  canUpdate: boolean
  state: UpdateState
  reason: string | null
  /**
   * When state is 'blocked' due to a dirty checkout, this lists up to a few
   * paths that are causing the block (modified, staged, or untracked files).
   * Surfaced in the UI so the user can see which files to deal with. See #293.
   */
  blockingFiles?: Array<string>
  updateMode:
    | 'git-ff'
    | 'hermes-strict'
    | 'hermes-update'
    | 'desktop-auto-updater'
    | 'docker-manual'
    | 'manual'
}

export type UpdateStatus = {
  ok: true
  checkedAt: number
  products: {
    workspace: ProductUpdateStatus
    agent: ProductUpdateStatus
  }
  updateAvailable: boolean
  pendingReleaseNotes: Array<ReleaseNoteSection>
}

export type ApplyUpdateResult = {
  ok: boolean
  product: ProductId
  output: string
  restartRequired: boolean
  status: ProductUpdateStatus
  releaseNotes: Array<ReleaseNoteSection>
  error?: string
}

// ---------------------------------------------------------------------------
// Pure helpers — no git/network/fs calls; take primitives, return values.
// Extracted so the update-availability and presentation logic can be unit-
// tested without any I/O.
// ---------------------------------------------------------------------------

/**
 * Returns true only when the local checkout is strictly BEHIND the remote tip:
 * the repo is on a supported branch, both HEADs are known, they differ, AND
 * local is a strict ancestor of remote (localBehindRemote).
 *
 * `localBehindRemote` is computed by the caller as
 *   `headsDiffer && canFastForward(repo, remoteRef)`
 * and passed in; this helper just ANDs the pieces together.
 */
export function isUpdateAvailable(opts: {
  supportedBranch: boolean
  currentHead: string | null
  latestHead: string | null
  localBehindRemote: boolean
}): boolean {
  return Boolean(
    opts.supportedBranch &&
    opts.currentHead &&
    opts.latestHead &&
    opts.currentHead !== opts.latestHead &&
    opts.localBehindRemote,
  )
}

/**
 * Derives the UI-visible state, reason string, and blocked flag for a product
 * update, given the pre-computed boolean inputs.
 *
 * Callers keep their own `!repoMatches` / `!supportedBranch` → 'unsupported'
 * branches — those are NOT folded into this helper.
 *
 * Truth table (assuming repoMatches & supportedBranch are already true):
 *   !updateAvailable                              → 'current', null, false
 *   updateAvailable && dirty && !trivialDirty     → 'blocked', labels.localChanges, true
 *   updateAvailable && !canSync                   → 'blocked', labels.verifyRef, false
 *   updateAvailable && canSync && !ff             → 'available', labels.diverged, false
 *   updateAvailable && canSync && ff              → 'available', null, false
 */
export function resolveUpdatePresentation(opts: {
  updateAvailable: boolean
  dirty: boolean
  trivialDirty: boolean
  canSync: boolean
  ff: boolean
  labels: { localChanges: string; verifyRef: string; diverged: string }
}): {
  state: 'available' | 'blocked' | 'current'
  reason: string | null
  blocked: boolean
} {
  const { updateAvailable, dirty, trivialDirty, canSync, ff, labels } = opts
  const state: 'available' | 'blocked' | 'current' = !updateAvailable
    ? 'current'
    : dirty && !trivialDirty
      ? 'blocked'
      : canSync
        ? 'available'
        : 'blocked'
  const reason: string | null = !updateAvailable
    ? null
    : dirty && !trivialDirty
      ? labels.localChanges
      : !canSync
        ? labels.verifyRef
        : !ff
          ? labels.diverged
          : null
  return { state, reason, blocked: state === 'blocked' }
}

function pendingNotesPath(): string {
  return join(process.cwd(), '.runtime', 'pending-update-release-notes.json')
}

function persistPendingReleaseNotes(sections: Array<ReleaseNoteSection>): void {
  if (!sections.length) return
  const path = pendingNotesPath()
  mkdirSync(join(process.cwd(), '.runtime'), { recursive: true })
  writeFileSync(
    path,
    `${JSON.stringify({ sections, updatedAt: Date.now() }, null, 2)}\n`,
  )
}

function readPendingReleaseNotes(): Array<ReleaseNoteSection> {
  try {
    const raw = JSON.parse(readFileSync(pendingNotesPath(), 'utf8')) as {
      sections?: Array<ReleaseNoteSection>
    }
    return Array.isArray(raw.sections) ? raw.sections : []
  } catch {
    return []
  }
}

function exec(
  command: string,
  args: Array<string>,
  options: { cwd?: string; timeout?: number; stdio?: 'pipe' | 'ignore' } = {},
): string | null {
  try {
    if (options.stdio === 'ignore') {
      execFileSync(command, args, {
        cwd: options.cwd ?? process.cwd(),
        timeout: options.timeout ?? 8_000,
        stdio: 'ignore',
      })
      return 'ok'
    }
    return (
      execFileSync(command, args, {
        cwd: options.cwd ?? process.cwd(),
        encoding: 'utf8',
        timeout: options.timeout ?? 8_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim() || null
    )
  } catch {
    return null
  }
}

function execOrThrow(
  command: string,
  args: Array<string>,
  options: { cwd?: string; timeout?: number } = {},
): string {
  return execFileSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    timeout: options.timeout ?? 300_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

function git(args: Array<string>, cwd: string, timeout = 8_000): string | null {
  return exec('git', args, { cwd, timeout })
}

function realGitRepoPath(path: string | null | undefined): string | null {
  if (!path) return null
  try {
    const resolved = realpathSync(path)
    return existsSync(join(resolved, '.git')) ? resolved : null
  } catch {
    return null
  }
}

function pkgVersion(repoPath: string): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(repoPath, 'package.json'), 'utf8'),
    ) as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Returns a canonical GitHub owner/repository name, never a partial match. */
export function canonicalGitHubRepo(url: string | null): string | null {
  if (!url) return null
  const normalized = url
    .trim()
    .replace(/^git@github\.com:/i, 'https://github.com/')
  const match = normalized.match(
    /^(?:https?:\/\/|ssh:\/\/git@)github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/i,
  )
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null
}

export function remoteUrlMatches(
  url: string | null,
  expected: Array<string>,
): boolean {
  const repo = canonicalGitHubRepo(url)
  return Boolean(repo && expected.some((alias) => repo === alias.toLowerCase()))
}

function remoteHead(
  repoPath: string,
  remote = 'origin',
  branch?: string | null,
): string | null {
  const url = git(['remote', 'get-url', remote], repoPath)
  if (!url) return null
  const raw = exec(
    'git',
    ['ls-remote', url, branch ? `refs/heads/${branch}` : 'HEAD'],
    {
      cwd: repoPath,
      timeout: 10_000,
    },
  )
  return raw?.split(/\s+/)[0] ?? null
}

function isDirty(repoPath: string): boolean {
  return Boolean(git(['status', '--porcelain'], repoPath))
}

/**
 * Return up to `limit` paths from `git status --porcelain` so the UI can
 * tell the user exactly which files are blocking an update. The shape of
 * each entry is the relative path inside the repo (XY status code stripped).
 */
function listDirtyFiles(repoPath: string, limit = 24): Array<string> {
  const raw = git(['status', '--porcelain'], repoPath)
  if (!raw) return []
  const out: Array<string> = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    // porcelain format: XY <space> path — but exec() trims the overall
    // output so the leading space (index-only = '') on the first line may
    // be lost.  Use a regex to strip 1-2 status chars + separator space.
    const path = line.replace(/^[A-Z?! ]{1,2}\s+/, '').trim()
    if (path) out.push(path)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Returns true when the only dirty file in the repo is `package.json` and the
 * diff is limited to a trivial version-string bump (e.g. `"version":
 * "2.3.27"` → `"version": "2.3.28"`).  This lets the update card show the
 * "Update" button when the server has already bumped the version but the
 * local checkout is one commit behind.
 */
export function isOnlyTrivialDirty(repoPath: string): boolean {
  const dirtyFiles = listDirtyFiles(repoPath)
  if (dirtyFiles.length !== 1 || dirtyFiles[0] !== 'package.json') return false
  const diff = git(['diff', 'package.json'], repoPath)
  if (!diff) return false
  // Every added/removed line must be a version-only change:
  //   +/-  "version": "<semver>"
  const diffLines = diff.split('\n')
  for (const line of diffLines) {
    if (!line.startsWith('+') && !line.startsWith('-')) continue
    if (line.startsWith('+++') || line.startsWith('---')) continue
    const content = line.slice(1).trim()
    if (content === '') continue
    // Allow only lines like "version": "x.y.z" (with or without surrounding whitespace / quotes)
    if (!/^[\s]*"version"\s*:\s*"[^"]+"[\s]*,?[\s]*$/.test(content))
      return false
  }
  return true
}

function canFastForward(repoPath: string, remoteRef: string): boolean {
  return (
    exec('git', ['merge-base', '--is-ancestor', 'HEAD', remoteRef], {
      cwd: repoPath,
      stdio: 'ignore',
    }) !== null
  )
}

function canVerifyRemoteRef(repoPath: string, remoteRef: string): boolean {
  return Boolean(git(['rev-parse', '--verify', remoteRef], repoPath, 10_000))
}

function syncRepoToRemote(repoPath: string, remoteRef: string): string {
  if (!canFastForward(repoPath, remoteRef)) {
    throw new Error(
      'Local branch is no longer a fast-forward ancestor of origin.',
    )
  }
  return execOrThrow('git', ['merge', '--ff-only', remoteRef], {
    cwd: repoPath,
    timeout: 60_000,
  })
}

function readCommits(
  repoPath: string,
  from: string | null,
  to: string | null,
): Array<string> {
  if (!from || !to || from === to) return []
  return (
    git(['log', '--pretty=format:%s (%h)', `${from}..${to}`], repoPath, 10_000)
      ?.split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 12) ?? []
  )
}

function workspaceInstallKind(): InstallKind {
  if (
    process.env.HERMES_WORKSPACE_DESKTOP === '1' ||
    process.env.ELECTRON_RUN_AS_NODE
  )
    return 'desktop'
  if (process.env.HERMES_WORKSPACE_DOCKER === '1' || existsSync('/.dockerenv'))
    return 'docker'
  return realGitRepoPath(process.cwd()) ? 'git' : 'unknown'
}

export function readWorkspaceUpdateStatus(
  repoPath = process.cwd(),
): ProductUpdateStatus {
  const installKind = workspaceInstallKind()
  const gitRepo = realGitRepoPath(repoPath)
  const version = gitRepo ? pkgVersion(gitRepo) : 'unknown'

  if (installKind === 'desktop') {
    return {
      id: 'workspace',
      label: 'Hermes Switch UI',
      installKind,
      version,
      path: repoPath,
      repoPath: gitRepo,
      branch: null,
      currentHead: null,
      latestHead: null,
      updateAvailable: false,
      canUpdate: false,
      state: 'unsupported',
      reason:
        'Desktop auto-updater manifest is not wired yet. This path is reserved for DMG/EXE packaging.',
      updateMode: 'desktop-auto-updater',
    }
  }

  if (installKind === 'docker') {
    return {
      id: 'workspace',
      label: 'Hermes Switch UI',
      installKind,
      version,
      path: repoPath,
      repoPath: gitRepo,
      branch: null,
      currentHead: null,
      latestHead: null,
      updateAvailable: false,
      canUpdate: false,
      state: 'unsupported',
      reason:
        'Docker installs should update by pulling a newer image/tag, not by mutating the running container.',
      updateMode: 'docker-manual',
    }
  }

  if (!gitRepo) {
    return {
      id: 'workspace',
      label: 'Hermes Switch UI',
      installKind: 'unknown',
      version,
      path: repoPath,
      repoPath: null,
      branch: null,
      currentHead: null,
      latestHead: null,
      updateAvailable: false,
      canUpdate: false,
      state: 'unsupported',
      reason: 'Workspace install type could not be detected.',
      updateMode: 'manual',
    }
  }

  const remoteUrl = git(['remote', 'get-url', 'origin'], gitRepo)
  const repoMatches = remoteUrlMatches(remoteUrl, [
    'interstellar-code/hermes-switchui',
    'outsourc-e/hermes-workspace',
  ])
  if (repoMatches) git(['fetch', 'origin', '--quiet'], gitRepo, 30_000)
  const currentHead = git(['rev-parse', 'HEAD'], gitRepo)
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], gitRepo)
  const supportedBranch = branch === 'main' || branch === 'master'
  const remoteRef = `origin/${branch || 'main'}`
  // The update target is the checked-out branch, not origin's default branch.
  const latestHead =
    repoMatches && supportedBranch
      ? git(['rev-parse', '--verify', remoteRef], gitRepo, 10_000)
      : null
  const dirty = isDirty(gitRepo)
  // Only advertise an update when the local checkout is strictly BEHIND the
  // remote: local HEAD is an ancestor of origin's branch tip AND they differ.
  // A checkout that is ahead of or diverged from origin is NOT out of date —
  // treating any SHA mismatch as an update wrongly nags on dev machines and
  // would hard-reset local commits on "update".
  const headsDiffer = Boolean(
    supportedBranch && currentHead && latestHead && currentHead !== latestHead,
  )
  const updateAvailable = headsDiffer && canFastForward(gitRepo, remoteRef)
  const canSync = updateAvailable
    ? canVerifyRemoteRef(gitRepo, remoteRef)
    : true
  const ff = updateAvailable ? canFastForward(gitRepo, remoteRef) : true
  const canUpdate = Boolean(
    repoMatches && supportedBranch && updateAvailable && !dirty && canSync,
  )

  return {
    id: 'workspace',
    label: 'Hermes Switch UI',
    installKind: 'git',
    version,
    path: repoPath,
    repoPath: gitRepo,
    branch,
    currentHead,
    latestHead,
    updateAvailable,
    canUpdate,
    ...((): Pick<ProductUpdateStatus, 'state' | 'reason' | 'blockingFiles'> => {
      if (!repoMatches)
        return {
          state: 'unsupported',
          reason: 'Switch UI origin remote does not look like hermes-switchui.',
        }
      if (!supportedBranch)
        return {
          state: 'unsupported',
          reason:
            'Switch UI one-click updates are only enabled on main/master branches.',
        }
      const presentation = resolveUpdatePresentation({
        updateAvailable,
        dirty,
        trivialDirty: false,
        canSync,
        ff,
        labels: {
          localChanges:
            'Switch UI checkout has local changes. Commit, stash, or remove the listed files before updating.',
          verifyRef: 'Switch UI update could not verify the remote branch ref.',
          diverged:
            'Switch UI branch diverged from origin. One-click updates only support fast-forward changes.',
        },
      })
      return {
        state: presentation.state,
        reason: presentation.reason,
        blockingFiles:
          updateAvailable && dirty ? listDirtyFiles(gitRepo) : undefined,
      }
    })(),
    updateMode: 'git-ff',
  }
}

function agentRepoPath(): string | null {
  const candidates = [
    process.env.HERMES_AGENT_REPO,
    join(homedir(), '.hermes', 'hermes-agent'),
    join(homedir(), 'Projects', 'hermes-agent'),
    join(homedir(), 'hermes-agent'),
  ]
  for (const candidate of candidates) {
    const repo = realGitRepoPath(candidate)
    if (repo) return repo
  }
  return null
}

export function readAgentUpdateStatus(): ProductUpdateStatus {
  const repoPath = agentRepoPath()
  const repoHermes = repoPath ? join(repoPath, 'venv', 'bin', 'hermes') : null
  const path =
    repoHermes && existsSync(repoHermes)
      ? repoHermes
      : exec('which', ['hermes'])
  const version =
    (path ? exec(path, ['--version'], { timeout: 10_000 }) : null)?.split(
      '\n',
    )[0] ?? 'unknown'

  if (!repoPath) {
    return {
      id: 'agent',
      label: 'Hermes Agent',
      installKind: 'unknown',
      version,
      path,
      repoPath: null,
      branch: null,
      currentHead: null,
      latestHead: null,
      updateAvailable: false,
      canUpdate: false,
      state: 'unsupported',
      reason:
        'Hermes Agent git checkout was not found. Bundled desktop installs will update through the app updater.',
      updateMode: 'manual',
    }
  }

  const remoteUrl = git(['remote', 'get-url', 'origin'], repoPath)
  const repoMatches = remoteUrlMatches(remoteUrl, [
    'interstellar-code/hermes-agent',
    'nousresearch/hermes-agent',
    'outsourc-e/hermes-agent',
  ])
  if (repoMatches) git(['fetch', 'origin', '--quiet'], repoPath, 30_000)
  const currentHead = git(['rev-parse', 'HEAD'], repoPath)
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)
  const latestHead =
    repoMatches && branch ? remoteHead(repoPath, 'origin', branch) : null
  const remoteRef = repoMatches ? `origin/${branch || 'main'}` : null
  const dirty = isDirty(repoPath)
  const trivialDirty = dirty && isOnlyTrivialDirty(repoPath)
  // Mirror the workspace rule: only an update when local is strictly BEHIND
  // remote (local HEAD is an ancestor of the remote branch tip), never when
  // the checkout is ahead of or diverged from origin.
  const headsDiffer = Boolean(
    currentHead && latestHead && currentHead !== latestHead && remoteRef,
  )
  const updateAvailable =
    headsDiffer && remoteRef ? canFastForward(repoPath, remoteRef) : false
  const canSync = remoteRef ? canVerifyRemoteRef(repoPath, remoteRef) : false
  const ff = remoteRef ? canFastForward(repoPath, remoteRef) : false
  const supportedBranch = branch === 'main' || branch === 'master'
  // Direct Git would skip the Agent's dependency repair and gateway restart.
  // Keep this check-only until the Agent exposes a strict update API.
  const canUpdate = false

  return {
    id: 'agent',
    label: 'Hermes Agent',
    installKind: 'git',
    version,
    path,
    repoPath,
    branch,
    currentHead,
    latestHead,
    updateAvailable,
    canUpdate,
    ...((): Pick<ProductUpdateStatus, 'state' | 'reason' | 'blockingFiles'> => {
      if (!repoMatches)
        return {
          state: 'unsupported',
          reason: 'Hermes Agent origin remote does not look like hermes-agent.',
        }
      if (!supportedBranch)
        return {
          state: 'unsupported',
          reason:
            'Hermes Agent one-click updates are only enabled on main/master branches.',
        }
      if (updateAvailable && !dirty)
        return {
          state: 'blocked',
          reason:
            'Automatic Agent updates require a strict Hermes updater API. Use the Hermes CLI updater for this release.',
        }
      const presentation = resolveUpdatePresentation({
        updateAvailable,
        dirty,
        trivialDirty,
        canSync,
        ff,
        labels: {
          localChanges:
            'Hermes Agent checkout has local changes. Commit, stash, or remove the listed files before updating.',
          verifyRef:
            'Hermes Agent update could not verify the remote branch ref.',
          diverged:
            'Hermes Agent branch diverged from origin. One-click updates only support fast-forward changes.',
        },
      })
      return {
        state: presentation.state,
        reason: presentation.reason,
        blockingFiles:
          updateAvailable && dirty ? listDirtyFiles(repoPath) : undefined,
      }
    })(),
    updateMode: 'manual',
  }
}

export async function readRemoteAgentUpdateStatus(): Promise<ProductUpdateStatus> {
  try {
    let response = await dashboardFetch('/api/hermes/update/check?force=true')
    if (!response.ok)
      throw new Error(`Agent update check failed (${response.status})`)
    let check = (await response.json()) as {
      install_method?: string
      current_version?: string
      behind?: number | null
      update_available?: boolean
      message?: string | null
      strict?: {
        strict_update_api?: number
        can_apply_strict?: boolean
        checkout_state?: string
        current_head?: string | null
        target_head?: string | null
        branch?: string | null
        blocking_files?: Array<string>
      }
    }
    // Hermes intentionally builds the strict block before its forced update
    // check fetches. Re-read only when that fetch discovered a newer target.
    if (
      check.update_available &&
      check.strict?.checkout_state === 'clean-uptodate'
    ) {
      response = await dashboardFetch('/api/hermes/update/check')
      if (response.ok) check = (await response.json()) as typeof check
    }
    const strict = check.strict
    const strictSupported = strict?.strict_update_api === 1
    const updateAvailable = Boolean(check.update_available)
    const canUpdate = Boolean(
      strictSupported && strict.can_apply_strict && updateAvailable,
    )
    const strictReason = strictSupported
      ? strictUpdateReason(strict.checkout_state)
      : null
    return {
      id: 'agent',
      label: 'Hermes Agent',
      installKind:
        check.install_method === 'git'
          ? 'git'
          : check.install_method === 'docker'
            ? 'docker'
            : 'unknown',
      version: check.current_version ?? 'unknown',
      path: null,
      repoPath: null,
      branch: strict?.branch ?? null,
      currentHead: strict?.current_head ?? null,
      latestHead: strict?.target_head ?? null,
      updateAvailable,
      canUpdate,
      state: updateAvailable
        ? canUpdate
          ? 'available'
          : 'blocked'
        : 'current',
      reason: updateAvailable
        ? (strictReason ??
          'Automatic Agent updates require a strict Hermes updater API. Use the Hermes CLI updater for this release.')
        : (check.message ?? null),
      blockingFiles: strict?.blocking_files,
      updateMode: strictSupported ? 'hermes-strict' : 'manual',
    }
  } catch {
    const local = readAgentUpdateStatus()
    return {
      ...local,
      canUpdate: false,
      reason:
        local.reason ??
        'Unable to check the configured Hermes Agent host for updates.',
      updateMode: 'manual',
    }
  }
}

export function strictUpdateReason(state?: string): string | null {
  switch (state) {
    case 'clean-behind':
    case 'clean-uptodate':
      return null
    case 'dirty':
      return 'Hermes Agent has local changes. Commit, stash, or remove the listed files before updating.'
    case 'ahead':
      return 'Hermes Agent has local commits that are not on the update branch.'
    case 'diverged':
      return 'Hermes Agent has diverged from the update branch and requires manual Git resolution.'
    case 'detached':
      return 'Hermes Agent is on a detached HEAD.'
    case 'unsupported-branch':
      return 'Hermes Agent is not on its configured update branch.'
    case 'wrong-remote':
      return 'Hermes Agent does not have the configured trusted update remote.'
    default:
      return state ? `Hermes Agent strict update is blocked (${state}).` : null
  }
}

export async function readUpdateStatus(): Promise<UpdateStatus> {
  const workspace = readWorkspaceUpdateStatus()
  const agent = await readRemoteAgentUpdateStatus()
  return {
    ok: true,
    checkedAt: Date.now(),
    products: { workspace, agent },
    updateAvailable: workspace.updateAvailable || agent.updateAvailable,
    pendingReleaseNotes: readPendingReleaseNotes(),
  }
}

export type WorkspaceUpdateAssertions = {
  expectedCurrentHead: string
  expectedTargetHead: string
}

export function workspaceUpdateAssertionsMatch(
  status: Pick<ProductUpdateStatus, 'currentHead' | 'latestHead'>,
  expected: WorkspaceUpdateAssertions,
): boolean {
  return (
    status.currentHead === expected.expectedCurrentHead &&
    status.latestHead === expected.expectedTargetHead
  )
}

export function applyWorkspaceUpdate(
  expected: WorkspaceUpdateAssertions,
): ApplyUpdateResult {
  const before = readWorkspaceUpdateStatus()
  if (!workspaceUpdateAssertionsMatch(before, expected)) {
    return {
      ok: false,
      product: 'workspace',
      output: '',
      restartRequired: false,
      status: before,
      releaseNotes: [],
      error: 'Workspace update status is stale. Refresh and try again.',
    }
  }
  if (!before.canUpdate || !before.repoPath || !before.branch) {
    return {
      ok: false,
      product: 'workspace',
      output: '',
      restartRequired: false,
      status: before,
      releaseNotes: [],
      error: before.reason || 'Workspace update is not available.',
    }
  }
  const output: Array<string> = []
  output.push(
    execOrThrow('git', ['fetch', 'origin'], {
      cwd: before.repoPath,
      timeout: 60_000,
    }),
  )
  const remoteRef = `origin/${before.branch}`
  const refreshed = readWorkspaceUpdateStatus()
  if (!workspaceUpdateAssertionsMatch(refreshed, expected)) {
    return {
      ok: false,
      product: 'workspace',
      output: output.filter(Boolean).join('\n'),
      restartRequired: false,
      status: refreshed,
      releaseNotes: [],
      error: 'Workspace update target changed. Refresh and try again.',
    }
  }
  if (!canVerifyRemoteRef(before.repoPath, remoteRef)) {
    const status = readWorkspaceUpdateStatus()
    return {
      ok: false,
      product: 'workspace',
      output: output.filter(Boolean).join('\n'),
      restartRequired: false,
      status,
      releaseNotes: [],
      error: `${remoteRef} could not be verified.`,
    }
  }
  if (
    git(['rev-parse', remoteRef], before.repoPath) !==
    expected.expectedTargetHead
  ) {
    const status = readWorkspaceUpdateStatus()
    return {
      ok: false,
      product: 'workspace',
      output: output.filter(Boolean).join('\n'),
      restartRequired: false,
      status,
      releaseNotes: [],
      error: 'Workspace update target changed. Refresh and try again.',
    }
  }
  // Re-check dirty state immediately before the destructive sync: the fetch
  // above could have introduced index changes, or the tree may have become
  // dirty between the initial readWorkspaceUpdateStatus() call and now.
  if (isDirty(before.repoPath)) {
    return {
      ok: false,
      product: 'workspace',
      output: output.filter(Boolean).join('\n'),
      restartRequired: false,
      status: readWorkspaceUpdateStatus(),
      releaseNotes: [],
      error: 'Working tree has uncommitted changes; refusing to update.',
    }
  }
  output.push(syncRepoToRemote(before.repoPath, remoteRef))
  const after = readWorkspaceUpdateStatus()
  const changedFiles =
    before.currentHead && after.currentHead
      ? (git(
          ['diff', '--name-only', before.currentHead, after.currentHead],
          before.repoPath,
          10_000,
        )
          ?.split('\n')
          .filter(Boolean) ?? [])
      : []
  if (
    changedFiles.some(
      (file) => file === 'package.json' || file === 'pnpm-lock.yaml',
    )
  ) {
    output.push(
      execOrThrow('pnpm', ['install', '--no-frozen-lockfile'], {
        cwd: before.repoPath,
        timeout: 180_000,
      }),
    )
  }
  if (
    changedFiles.some(
      (file) =>
        file.startsWith('src/') ||
        file === 'package.json' ||
        file === 'pnpm-lock.yaml' ||
        file.startsWith('vite') ||
        file.startsWith('tsconfig'),
    )
  ) {
    output.push(
      execOrThrow('pnpm', ['build'], {
        cwd: before.repoPath,
        timeout: 240_000,
      }),
    )
  }
  const releaseNotes = [
    {
      product: 'workspace' as const,
      label: 'Hermes Switch UI',
      from: before.currentHead,
      to: after.currentHead,
      commits: readCommits(
        before.repoPath,
        before.currentHead,
        after.currentHead,
      ),
    },
  ]
  persistPendingReleaseNotes(releaseNotes)
  return {
    ok: true,
    product: 'workspace',
    output: output.filter(Boolean).join('\n'),
    restartRequired: before.currentHead !== after.currentHead,
    status: after,
    releaseNotes,
  }
}

export async function applyAgentUpdate(
  expected: WorkspaceUpdateAssertions,
): Promise<ApplyUpdateResult> {
  const before = await readRemoteAgentUpdateStatus()
  if (!workspaceUpdateAssertionsMatch(before, expected)) {
    return {
      ok: false,
      product: 'agent',
      output: '',
      restartRequired: false,
      status: before,
      releaseNotes: [],
      error: 'Agent update status is stale. Refresh and try again.',
    }
  }
  if (!before.canUpdate || before.updateMode !== 'hermes-strict') {
    return {
      ok: false,
      product: 'agent',
      output: '',
      restartRequired: false,
      status: before,
      releaseNotes: [],
      error: before.reason || 'Hermes Agent update is not available.',
    }
  }

  const response = await dashboardFetch('/api/hermes/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'strict',
      expected_current_head: expected.expectedCurrentHead,
      expected_target_head: expected.expectedTargetHead,
    }),
  })
  const applied = (await response.json().catch(() => ({}))) as {
    ok?: boolean
    action?: string
    reason?: string
    error?: string
    refresh_error?: string
    restart_required?: boolean
  }
  if (!response.ok || !applied.ok) {
    return {
      ok: false,
      product: 'agent',
      output: '',
      restartRequired: false,
      status: await readRemoteAgentUpdateStatus(),
      releaseNotes: [],
      error:
        applied.reason ||
        applied.error ||
        `Agent update failed (${response.status}).`,
    }
  }
  if (applied.refresh_error || !applied.action) {
    return {
      ok: false,
      product: 'agent',
      output: '',
      restartRequired: true,
      status: await readRemoteAgentUpdateStatus(),
      releaseNotes: [],
      error:
        applied.refresh_error ||
        'Agent source updated, but post-update refresh did not start.',
    }
  }

  const action = await waitForAgentUpdateAction(applied.action)
  const after = await readRemoteAgentUpdateStatus()
  if (action.exitCode !== 0) {
    return {
      ok: false,
      product: 'agent',
      output: action.lines.join('\n'),
      restartRequired: true,
      status: after,
      releaseNotes: [],
      error:
        'Agent source updated, but dependency refresh or gateway restart failed.',
    }
  }
  const releaseNotes = [
    {
      product: 'agent' as const,
      label: 'Hermes Agent',
      from: before.currentHead,
      to: after.currentHead,
      commits: [],
    },
  ]
  persistPendingReleaseNotes(releaseNotes)
  return {
    ok: true,
    product: 'agent',
    output: action.lines.join('\n'),
    restartRequired: Boolean(applied.restart_required),
    status: after,
    releaseNotes,
  }
}

async function waitForAgentUpdateAction(
  action: string,
): Promise<{ exitCode: number; lines: Array<string> }> {
  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    const response = await dashboardFetch(
      `/api/actions/${encodeURIComponent(action)}/status?lines=200`,
    )
    if (response.ok) {
      const status = (await response.json()) as {
        running?: boolean
        exit_code?: number | null
        lines?: Array<string>
      }
      if (!status.running && typeof status.exit_code === 'number') {
        return { exitCode: status.exit_code, lines: status.lines ?? [] }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  throw new Error('Timed out waiting for Hermes Agent post-update refresh.')
}
