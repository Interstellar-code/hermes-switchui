/**
 * settings-equal.ts — structural equality for settings values.
 *
 * The Settings store decides "is this key still dirty?" by comparing the
 * draft value against committed server truth. `===` cannot answer that for
 * the config keys whose editors rebuild a container on every keystroke:
 * `config.terminal.docker_volumes`, `config.skills.external_dirs` and
 * `config.command_allowlist` all produce a *fresh array* per edit, so
 * `committed[key] !== value` was true even after the user typed the value
 * back to what it was. Those keys could never return to clean, and Save kept
 * shipping a no-op patch for them.
 *
 * Config values come from YAML, so the shapes are scalars, arrays and plain
 * objects. Depth is bounded because a hostile or cyclic value must not hang
 * the render path — beyond the limit we fall back to reference equality,
 * which is the old behaviour and therefore never worse.
 */

const MAX_DEPTH = 8

export function valuesEqual(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true
  if (depth >= MAX_DEPTH) return false
  if (a === null || b === null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false

  const aIsArray = Array.isArray(a)
  if (aIsArray !== Array.isArray(b)) return false

  if (aIsArray) {
    const arrA = a as Array<unknown>
    const arrB = b as Array<unknown>
    if (arrA.length !== arrB.length) return false
    for (let i = 0; i < arrA.length; i++) {
      if (!valuesEqual(arrA[i], arrB[i], depth + 1)) return false
    }
    return true
  }

  const objA = a as Record<string, unknown>
  const objB = b as Record<string, unknown>
  const keysA = Object.keys(objA)
  const keysB = Object.keys(objB)
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false
    if (!valuesEqual(objA[key], objB[key], depth + 1)) return false
  }
  return true
}
