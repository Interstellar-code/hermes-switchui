import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import path from 'node:path'

/** `unknown`: the check timed out or the path was not probed (network mount). */
export type GitStatus = { git: boolean; branch?: string; unknown?: true }

const TTL_MS = 60_000
const TIMEOUT_MS = 1_500
const MAX_SMALL_FILE = 4096
const MAX_BRANCH = 255

const cache = new Map<
  string,
  { at: number; settled: boolean; promise: Promise<GitStatus> }
>()

/**
 * Read a small regular file (≤4 KB) without following a symlink and without
 * blocking on a FIFO/device; null for anything else.
 */
async function readSmallFile(file: string): Promise<string | null> {
  let handle
  try {
    handle = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_SMALL_FILE) return null
    const buf = Buffer.alloc(MAX_SMALL_FILE)
    const { bytesRead } = await handle.read(buf, 0, MAX_SMALL_FILE, 0)
    return buf.subarray(0, bytesRead).toString('utf8')
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}

/** Branch name, or a 7-char sha for a detached HEAD; undefined otherwise. */
function branchOf(head: string): string | undefined {
  const text = head.trim()
  const ref = /^ref: refs\/heads\/(.+)$/.exec(text)
  if (ref) return ref[1].length <= MAX_BRANCH ? ref[1] : undefined
  return /^[0-9a-f]{40,64}$/.test(text) ? text.slice(0, 7) : undefined
}

const onVolumes = (p: string) => p === '/Volumes' || p.startsWith('/Volumes/')

async function probe(dir: string): Promise<GitStatus> {
  const dotGit = path.join(dir, '.git')
  let info
  try {
    info = await lstat(dotGit)
  } catch {
    return { git: false }
  }
  let gitDir: string | null = null
  if (info.isDirectory()) gitDir = dotGit
  else if (info.isFile()) {
    // Worktree / submodule: `gitdir: <path>` pointer file.
    const pointer = /^gitdir:\s*(.+)$/m.exec(
      (await readSmallFile(dotGit)) ?? '',
    )
    if (!pointer) return { git: false }
    gitDir = path.resolve(dir, pointer[1].trim())
    // A pointer onto a network mount is as risky as the mount itself.
    if (onVolumes(gitDir)) return { git: true }
  } else return { git: false }
  const head = await readSmallFile(path.join(gitDir, 'HEAD'))
  const branch = head === null ? undefined : branchOf(head)
  return branch ? { git: true, branch } : { git: true }
}

/**
 * Whether `dir` is a git checkout, from `<dir>/.git` alone (a directory, or a
 * `gitdir:` pointer file). Nothing is executed and no repo content is read
 * beyond HEAD. One probe in flight per dir (a hung mount is not re-probed
 * while it hangs), results cached for a minute, and callers give up after
 * 1.5s with `unknown`. Paths under /Volumes are never probed: a dead network
 * mount there hangs the fs threadpool for everyone.
 */
export function gitStatusOf(
  dir: string,
  timeoutMs = TIMEOUT_MS,
): Promise<GitStatus> {
  if (onVolumes(dir)) return Promise.resolve({ git: false, unknown: true })
  let entry = cache.get(dir)
  if (!entry || (entry.settled && Date.now() - entry.at >= TTL_MS)) {
    const fresh = {
      at: Date.now(),
      settled: false,
      promise: probe(dir),
    }
    void fresh.promise.finally(() => {
      fresh.settled = true
      fresh.at = Date.now()
    })
    cache.set(dir, fresh)
    entry = fresh
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<GitStatus>((resolve) => {
    timer = setTimeout(() => resolve({ git: false, unknown: true }), timeoutMs)
    timer.unref()
  })
  return Promise.race([entry.promise, timeout]).finally(() =>
    clearTimeout(timer),
  )
}

/** Test hook: forget cached results. */
export function clearGitStatusCache(): void {
  cache.clear()
}
