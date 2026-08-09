/**
 * Shared merge semantics for a profile's `config.yaml` update (P-XX).
 *
 * This is the ONE place the "deep-merge, except `mcp_servers` replaces
 * wholesale, and `null` means delete" algorithm exists. It used to be
 * duplicated: once in `updateProfileConfig()` (`src/server/profiles-browser.ts`,
 * the code path that actually writes `config.yaml`), and again in
 * `predictMergedConfig()` (`src/screens/profiles/profile-config-map.ts`), which
 * re-implements the same algorithm client-side so the wizard's review step can
 * show an honest before/after diff of what a save will actually do.
 *
 * Two independent copies meant adding a key to the server's replace-whole set
 * — or tweaking either deep-merge — would silently make the client's diff
 * preview lie about what a save actually does, with no compiler or test
 * forcing the two back into agreement. Both call sites now import from here
 * instead of carrying their own copy; see `profile-merge.contract.test.ts` for
 * the regression test that would catch a future re-fork.
 *
 * IMPORTANT: no `node:` imports. `profile-config-map.ts` is bundled into the
 * browser, so this module must stay filesystem- and Node-free — that is
 * exactly the property that lets `profiles-browser.ts` (server-only, heavy
 * `node:fs` user) and the client wizard both depend on it safely.
 */

export type ConfigRecord = Record<string, unknown>

/**
 * Top-level config keys whose object value is REPLACED wholesale by an update
 * instead of being deep-merged into the existing value.
 *
 * `mcp_servers` is the only member, and deliberately so. It is a map keyed by
 * server name whose sole writer (wizard step 5) always POSTs the complete
 * selected map. Deep-merging a map can only ever add or overwrite keys, never
 * drop one, so deselecting an MCP server saved "successfully" and changed
 * nothing. Last-write-wins is the correct contract for a value whose writer
 * always sends it whole.
 *
 * Do NOT add `agent_ui` here. The wizard's edit payload deliberately omits
 * `tier` and `status` (the update route rejects `status` outright and refuses
 * tier changes after creation), so replacing `agent_ui` wholesale would strip
 * both fields off every profile on its first save. Arrays — `tags`,
 * `skills.external_dirs`, `agent.disabled_toolsets` — already replace correctly
 * via `deepMerge`'s `Array.isArray` branch and need no entry here either.
 */
export const REPLACE_WHOLE_CONFIG_KEYS = ['mcp_servers'] as const

/**
 * Deep-merge `source` into `target`, mutating `target` in place.
 *
 * A plain-object `source` value recurses into the existing `target` value
 * when that target value is itself non-null and `typeof === 'object'`
 * (arrays included — this is ported verbatim from the original
 * `profiles-browser.ts` implementation, not re-derived, so behaviour that
 * depended on it is preserved exactly). Anything else — primitives, an array
 * `source` value, or a `target` value that isn't already an object — is a
 * plain overwrite.
 */
export function deepMerge(target: ConfigRecord, source: ConfigRecord): void {
  for (const [key, value] of Object.entries(source)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === 'object'
    ) {
      deepMerge(target[key] as ConfigRecord, value as ConfigRecord)
    } else {
      target[key] = value
    }
  }
}

/**
 * Apply an update patch onto an existing config, mutating and returning
 * `current`:
 *
 *  1. Any key in `patch` whose value is `null` is an explicit removal —
 *     deleted from `current`, and from the working copy of the patch, before
 *     anything else runs.
 *  2. Any key in {@link REPLACE_WHOLE_CONFIG_KEYS} still present in the patch
 *     overwrites `current[key]` wholesale (no merge). This runs after step 1
 *     so e.g. `{ mcp_servers: null }` still deletes the key rather than
 *     "replacing" it with `null`.
 *  3. Everything left deep-merges via {@link deepMerge}.
 *
 * This is the exact algorithm `updateProfileConfig()` in
 * `src/server/profiles-browser.ts` persists to disk, and the exact algorithm
 * `predictMergedConfig()` in `src/screens/profiles/profile-config-map.ts` uses
 * to preview it before the user saves — see the module doc comment above for
 * why the two must never drift apart again.
 */
export function mergeProfileConfig(
  current: ConfigRecord,
  patch: ConfigRecord,
): ConfigRecord {
  const updates: ConfigRecord = { ...patch }
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) {
      delete current[key]
      delete updates[key]
    }
  }
  for (const key of REPLACE_WHOLE_CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      current[key] = updates[key]
      delete updates[key]
    }
  }
  deepMerge(current, updates)
  return current
}
