/**
 * path-containment.ts — the symlink-aware half of "is this path inside that
 * directory," shared by every route that serves a file off disk by a
 * caller-supplied relative path (`docs-asset.ts`, `hermes-docs.ts`).
 *
 * A plain string-prefix check on `path.join(root, relative)` is not enough:
 * `relative` can be structurally safe (no `..`, not absolute) and still name
 * a path that is *itself* a symlink — a file or a whole directory — planted
 * inside `root` but resolving somewhere else entirely. `fs.realpathSync`
 * follows every symlink in the chain, so resolving BOTH the root and the
 * candidate and requiring the resolved candidate to sit under the resolved
 * root is what actually closes that hole; a prefix check on the
 * pre-resolution string does not see through the symlink at all.
 *
 * This function only does that filesystem-truth half of the check. Callers
 * are expected to have already rejected `..`, absolute paths, null bytes and
 * any extension/allowlist rules of their own — `relative` here should
 * already be a normalized, root-relative candidate — and to run their own
 * `stat` afterward if they need to distinguish a file from a directory.
 */
import fs from 'node:fs'
import path from 'node:path'

export type PathContainmentReason =
  | 'missing-root'
  | 'not-found'
  | 'escapes-root'

export class PathContainmentError extends Error {
  constructor(
    message: string,
    readonly reason: PathContainmentReason,
  ) {
    super(message)
    this.name = 'PathContainmentError'
  }
}

/**
 * Resolve `relative` against `root`, following symlinks in both, and
 * guarantee the result is a real, existing path that stays inside the real
 * root. Returns the resolved absolute path. Throws `PathContainmentError` —
 * never returns a path outside `root`.
 */
export function resolveContainedPath(root: string, relative: string): string {
  let realRoot: string
  try {
    realRoot = fs.realpathSync(root)
  } catch {
    // Root missing entirely (uninstalled/not-shipped docs tree, moved
    // directory, race with a concurrent delete) — a clean "not found" for
    // the caller to degrade on, not a thrown filesystem error.
    throw new PathContainmentError('Root not found', 'missing-root')
  }

  const joined = path.join(realRoot, relative)

  let real: string
  try {
    real = fs.realpathSync(joined)
  } catch {
    throw new PathContainmentError('Not found', 'not-found')
  }

  // The check that actually matters: realpath resolves every symlink in the
  // chain (including the final component), so a symlink planted inside root
  // — file or directory — that points outside it is caught here even though
  // the pre-resolution path looked contained.
  const rootWithSep = realRoot.endsWith(path.sep)
    ? realRoot
    : realRoot + path.sep
  if (real !== realRoot && !real.startsWith(rootWithSep)) {
    throw new PathContainmentError('Path escapes the root', 'escapes-root')
  }

  return real
}
