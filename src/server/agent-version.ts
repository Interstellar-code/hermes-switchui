/**
 * Parsing and comparing agent version strings. Nothing else.
 *
 * **Dependency-free on purpose.** `hermes-slash-policy.ts` imports
 * `meetsAgentVersionFloor` to apply its version floor, and that file is also
 * imported by the browser (`use-slash-commands.ts` reads
 * `SLASH_EXEC_ALLOWLIST` and `INTENTIONALLY_SHADOWED_COMMANDS` from it). So
 * this half must never reach for the network, the filesystem, or
 * `gateway-capabilities.ts` — which starts a live gateway probe at module
 * scope, and which pulled that probe into every jsdom hook test the one time
 * this file imported it.
 *
 * Reading the *running* agent's version — the half that does touch the
 * network — is `hermes-agent-version.ts`, server-only. The floor value and the
 * refusal wording are policy and live in `hermes-slash-policy.ts`
 * (`MIN_AGENT_VERSION_FOR_SLASH_EXEC`, `agentVersionFloorRefusal`), so raising
 * the floor happens in the file that already records what each allowlist entry
 * was measured against, and never here.
 */

/**
 * A version split into its numeric release core and its prerelease
 * identifiers. `0.19.16` → `{release: [0, 19, 16], prerelease: []}`;
 * `0.20.0-rc.2` → `{release: [0, 20, 0], prerelease: ['rc', 2]}`.
 *
 * The core is a list rather than a fixed major/minor/patch triple because
 * hermes-agent is not the only thing whose version passes through here — its
 * `/api/status` also carries `release_date: "2026.8.13.3"`, a four-segment
 * number — and a comparator that silently ignored a fourth segment would be
 * the same class of bug as comparing the strings.
 */
export type ParsedAgentVersion = {
  release: Array<number>
  prerelease: Array<string | number>
}

/**
 * `v?` numeric core, optional `-prerelease`, optional `+build`.
 *
 * Deliberately strict about the core: anything with a non-numeric segment
 * (`0.19.x`, `latest`, `unknown`, `dev`) fails to parse and therefore fails
 * closed, which is the whole point. Build metadata is matched so it can be
 * discarded — semver says it takes no part in precedence.
 */
const VERSION_PATTERN =
  /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/** Parse a version string. Returns null for anything it cannot prove. */
export function parseAgentVersion(raw: unknown): ParsedAgentVersion | null {
  if (typeof raw !== 'string') return null
  const match = VERSION_PATTERN.exec(raw.trim())
  if (!match) return null
  const release = match[1].split('.').map((part) => Number(part))
  if (release.some((part) => !Number.isFinite(part))) return null
  // The prerelease group is optional, so this really is undefined most of the
  // time — annotated rather than inferred because the index signature on a
  // match array claims `string` for every position.
  const prereleaseRaw: string | undefined = match[2]
  const prerelease: Array<string | number> = prereleaseRaw
    ? prereleaseRaw.split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id))
    : []
  return { release, prerelease }
}

/**
 * `-1` / `0` / `1` for a < b, a == b, a > b — or **null** when either side is
 * unparseable, which every caller must treat as "below the floor".
 *
 * Segment-wise numeric comparison, never lexicographic: the case this exists
 * for is `0.19.9` vs `0.19.16`, where a string compare says `"0.19.9" >
 * "0.19.16"` and would wave through the exact deployment the floor is meant to
 * catch. Missing trailing segments count as 0, so `0.19` == `0.19.0`.
 *
 * Prerelease precedence follows semver §11: a prerelease ranks **below** the
 * release it precedes (`0.19.16-rc.1` < `0.19.16`), numeric identifiers
 * compare numerically and rank below alphanumeric ones, and a shorter run of
 * identifiers ranks below a longer one with the same prefix. That direction
 * matters: it means an `-rc` build of the floor version is refused rather than
 * trusted, which is the safe way round for a build that by definition has not
 * been measured.
 */
export function compareAgentVersions(a: unknown, b: unknown): number | null {
  const left = parseAgentVersion(a)
  const right = parseAgentVersion(b)
  if (!left || !right) return null

  const coreLength = Math.max(left.release.length, right.release.length)
  for (let i = 0; i < coreLength; i += 1) {
    const l = left.release[i] ?? 0
    const r = right.release[i] ?? 0
    if (l !== r) return l < r ? -1 : 1
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1

  const preLength = Math.max(left.prerelease.length, right.prerelease.length)
  for (let i = 0; i < preLength; i += 1) {
    // `.at` rather than `[i]`: the two arrays can be different lengths here and
    // the shorter one running out is exactly the case semver decides by length,
    // so the `undefined` has to survive into the type.
    const l = left.prerelease.at(i)
    const r = right.prerelease.at(i)
    if (l === undefined) return -1
    if (r === undefined) return 1
    if (typeof l === 'number' && typeof r === 'number') {
      if (l !== r) return l < r ? -1 : 1
      continue
    }
    // Numeric identifiers always have lower precedence than alphanumeric ones.
    if (typeof l === 'number') return -1
    if (typeof r === 'number') return 1
    if (l !== r) return l < r ? -1 : 1
  }
  return 0
}

/**
 * True when `version` is at least `floor`. **False for an unknown or
 * unparseable version** — the one behaviour every caller depends on, and the
 * reason this returns a boolean rather than exposing the null from
 * `compareAgentVersions`.
 */
export function meetsAgentVersionFloor(
  version: string | null | undefined,
  floor: string,
): boolean {
  const cmp = compareAgentVersions(version, floor)
  return cmp !== null && cmp >= 0
}

