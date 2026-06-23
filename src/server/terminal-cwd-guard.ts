/**
 * CWD containment guard for terminal sessions.
 *
 * Resolves the requested working directory and asserts it is inside one of
 * the allowed roots (user home dir, or an operator-supplied override via
 * TERMINAL_ALLOWED_CWD_ROOTS). Rejects symlink/traversal escapes by
 * comparing the fully-resolved absolute path with a trailing-separator-aware
 * prefix check — same pattern used by the /api/media endpoint (#146).
 */
import { resolve, sep } from 'node:path'
import { homedir } from 'node:os'

/**
 * Returns the list of absolute directory roots that a terminal cwd is
 * permitted to be inside. The user's home directory is always included.
 * Operators may add extra roots via TERMINAL_ALLOWED_CWD_ROOTS (colon-
 * separated absolute paths, same syntax as PATH).
 */
export function getAllowedCwdRoots(): Array<string> {
  const home = process.env.HOME ?? homedir()
  const roots: Array<string> = [home]

  const extra = process.env.TERMINAL_ALLOWED_CWD_ROOTS ?? ''
  for (const raw of extra.split(':')) {
    const trimmed = raw.trim()
    if (trimmed) roots.push(trimmed)
  }

  return roots
}

/**
 * Return true when `resolvedPath` is equal to `root` or is a direct
 * descendant of it. The trailing-separator check prevents `/home/user-evil`
 * from satisfying a root of `/home/user`.
 */
function isInsideRoot(resolvedPath: string, root: string): boolean {
  return resolvedPath === root || resolvedPath.startsWith(root + sep)
}

/**
 * Resolve `cwd` to an absolute path (after `~` expansion) and assert it
 * is contained within one of the allowed roots.
 *
 * Returns the fully-resolved absolute path on success.
 * Throws an Error with `code: 'CWD_NOT_ALLOWED'` on violation.
 */
export function assertAllowedCwd(
  cwd: string,
  roots: Array<string> = getAllowedCwdRoots(),
): string {
  const home = process.env.HOME ?? homedir()

  // Expand leading `~` before resolving so `~/projects` works.
  const expanded = cwd.startsWith('~') ? cwd.replace(/^~/, home) : cwd

  // `resolve` collapses `..`, absolute symlink targets, and relative segments.
  const resolved = resolve(expanded)

  if (!roots.some((root) => isInsideRoot(resolved, resolve(root)))) {
    throw Object.assign(
      new Error(
        `Working directory "${cwd}" resolves to "${resolved}" which is outside the allowed roots. ` +
          `Set TERMINAL_ALLOWED_CWD_ROOTS to permit additional directories.`,
      ),
      { code: 'CWD_NOT_ALLOWED' },
    )
  }

  return resolved
}
