/**
 * path-utils.ts — shared POSIX/Windows path helpers for browser code.
 *
 * Browser code can't use Node's `path` module directly. These are the small
 * portable helpers that screens were each reinventing inline.
 */

/** Lower-case file extension (without the leading dot); empty string when none. */
export function getExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** Parent directory path with forward-slash separators; empty string at root. */
export function getParentPath(pathValue: string): string {
  const parts = pathValue.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}
