/**
 * hermes-docs.ts — serve the Hermes Agent documentation that already ships
 * inside the local install (`<agent-dir>/website/docs/`, a Docusaurus source
 * tree verified byte-identical to the live site at
 * https://hermes-agent.nousresearch.com/docs/).
 *
 * Rather than re-explaining Hermes concepts (multiplexing, terminal backends,
 * ...) in UI tooltips that drift from the real docs, Switch UI links straight
 * into this local copy and renders the markdown inline. Read at request time
 * — never bundled or copied — so it always tracks whatever hermes-agent
 * version is actually installed.
 *
 * ## Path containment
 *
 * This reads arbitrary files off disk if the containment check is wrong, so
 * it is deliberately layered:
 *   1. Reject absolute paths and any segment containing `..` before touching
 *      the filesystem (`path.posix.normalize` + an explicit prefix check).
 *   2. Resolve BOTH the docs root and the candidate file with
 *      `fs.realpathSync`, which follows symlinks, and require the resolved
 *      file to sit under the resolved root with a trailing separator. A
 *      structurally-safe path that is itself a symlink pointing outside the
 *      docs root (or passes through one on the way down) is still caught
 *      here — the realpath check is what actually matters; step 1 is
 *      defense-in-depth for the common case. This half lives in
 *      `./path-containment` (`resolveContainedPath`) so `docs-asset.ts`
 *      reuses the exact same check instead of a third hand-rolled variant.
 *   3. Only `.md` / `.mdx` files are servable — this is a docs reader, not a
 *      generic file server.
 *
 * ## Missing install
 *
 * Not every Switch UI deployment has a local hermes-agent checkout (e.g. it
 * talks to a remote gateway). `readHermesDoc` reports `no-docs-root` rather
 * than throwing so the route can degrade to the live docs URL instead of
 * erroring.
 */
import fs from 'node:fs'
import path from 'node:path'
import { resolveClaudeAgentDir } from './claude-agent'
import { PathContainmentError, resolveContainedPath } from './path-containment'

/** Docusaurus site config: `url: 'https://hermes-agent.nousresearch.com'`, `baseUrl: '/docs/'`. */
export const HERMES_DOCS_LIVE_BASE_URL =
  'https://hermes-agent.nousresearch.com/docs/'

export type HermesDocsInvalidReason = 'invalid-path' | 'not-found'

export class HermesDocsPathError extends Error {
  constructor(
    message: string,
    readonly reason: HermesDocsInvalidReason,
  ) {
    super(message)
    this.name = 'HermesDocsPathError'
  }
}

/**
 * Locate the docs source directory shipped inside the installed hermes-agent
 * checkout. `HERMES_DOCS_ROOT` is an explicit override for tests/unusual
 * layouts; otherwise this rides the same directory resolution as the rest of
 * Switch UI's hermes-agent integration (`resolveClaudeAgentDir`).
 */
export function resolveHermesDocsRoot(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const override = env.HERMES_DOCS_ROOT?.trim()
  if (override) return override

  const agentDir = resolveClaudeAgentDir(env)
  if (!agentDir) return null
  return path.join(agentDir, 'website', 'docs')
}

const ALLOWED_EXTENSIONS = new Set(['.md', '.mdx'])

/**
 * Resolve `rawPath` against `docsRoot`, guaranteeing the result is a real
 * file that stays inside `docsRoot` even across symlinks. Throws
 * `HermesDocsPathError` — never returns a path outside the root.
 *
 * `docsRoot` itself must already exist (callers check that separately so
 * they can distinguish "no local install" from "bad path").
 */
export function resolveHermesDocPath(
  docsRoot: string,
  rawPath: string,
): string {
  const trimmed = rawPath.trim()
  if (!trimmed) {
    throw new HermesDocsPathError('Missing path', 'invalid-path')
  }
  if (trimmed.includes('\0')) {
    throw new HermesDocsPathError('Invalid path', 'invalid-path')
  }

  // Reject absolute paths in both POSIX and Windows form up front.
  if (
    path.posix.isAbsolute(trimmed) ||
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith('\\\\')
  ) {
    throw new HermesDocsPathError(
      'Absolute paths are not allowed',
      'invalid-path',
    )
  }

  // Normalize on POSIX separators regardless of platform so a `..\\` on
  // Windows-style input can't slip past a POSIX-only check.
  const posixCandidate = trimmed.replace(/\\/g, '/')
  const normalized = path.posix.normalize(posixCandidate)
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new HermesDocsPathError('Path escapes the docs root', 'invalid-path')
  }

  const ext = path.posix.extname(normalized).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new HermesDocsPathError(
      'Only .md/.mdx files can be served',
      'invalid-path',
    )
  }

  let real: string
  try {
    real = resolveContainedPath(docsRoot, normalized)
  } catch (err) {
    if (err instanceof PathContainmentError) {
      // Caller is expected to have already verified the root exists; treat
      // a root that vanished in a race, and a missing file, the same way —
      // "not found" rather than leaking the raw filesystem error. A symlink
      // escape is the one case worth calling out as an invalid path rather
      // than a mere 404.
      throw new HermesDocsPathError(
        err.reason === 'escapes-root'
          ? 'Path escapes the docs root'
          : 'Not found',
        err.reason === 'escapes-root' ? 'invalid-path' : 'not-found',
      )
    }
    throw err
  }

  let stat: fs.Stats
  try {
    stat = fs.statSync(real)
  } catch {
    throw new HermesDocsPathError('Not found', 'not-found')
  }
  if (!stat.isFile()) {
    throw new HermesDocsPathError('Not found', 'not-found')
  }

  return real
}

export type HermesDocResult =
  | { ok: true; path: string; content: string }
  | {
      ok: false
      reason: 'no-docs-root' | HermesDocsInvalidReason
      message: string
    }

/**
 * Read one doc by its path relative to the docs root (e.g.
 * `user-guide/multi-profile-gateways.md`).
 */
export function readHermesDoc(
  rawPath: string,
  env: Record<string, string | undefined> = process.env,
): HermesDocResult {
  const root = resolveHermesDocsRoot(env)
  if (!root || !fs.existsSync(root)) {
    return {
      ok: false,
      reason: 'no-docs-root',
      message: 'Local Hermes docs are not installed on this machine.',
    }
  }

  try {
    const real = resolveHermesDocPath(root, rawPath)
    const content = fs.readFileSync(real, 'utf-8')
    const realRoot = fs.realpathSync(root)
    const relative = path.relative(realRoot, real).split(path.sep).join('/')
    return { ok: true, path: relative, content }
  } catch (err) {
    if (err instanceof HermesDocsPathError) {
      return { ok: false, reason: err.reason, message: err.message }
    }
    return { ok: false, reason: 'invalid-path', message: 'Invalid path' }
  }
}

/** Build the live-site URL to fall back to for a docs-relative path. */
export function hermesDocsLiveUrl(relativePath: string): string {
  const clean = relativePath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\.mdx?$/i, '')
    .replace(/\/index$/, '')
  return `${HERMES_DOCS_LIVE_BASE_URL}${clean}`
}
