/**
 * Maps a caught error to an honest HTTP status code for the
 * `/api/profiles/*` route handlers.
 *
 * INTERIM MEASURE: `profiles-browser.ts` throws plain `Error`s with string
 * messages rather than typed error classes, and a concurrent change is in
 * flight against that file, so introducing typed errors there right now is
 * off the table. This module maps on the *exact* message strings those
 * throwers use as a stopgap so route handlers stop reporting every user
 * error (not found, already exists, reserved name, ...) as a 500.
 *
 * The correct end state is typed errors (e.g. `ProfileNotFoundError`,
 * `ProfileConflictError`, `ProfileForbiddenError`) exported from
 * `profiles-browser.ts`, with this helper (or its replacement) doing an
 * `instanceof` check instead of string-matching. Do that once
 * `profiles-browser.ts` is free to change again, and delete the mapping
 * table below.
 *
 * Every entry names the function that throws the message it matches, so the
 * table stays auditable as `profiles-browser.ts` / `profiles-trash.ts`
 * evolve. Anything unmatched falls back to 500 — an unrecognised message
 * must never be mislabelled as a user error.
 */

type ErrorMapping = {
  status: number
  /** Which function throws the message(s) this entry matches. */
  thrownBy: string
  test: (message: string) => boolean
}

const ERROR_MAPPINGS: Array<ErrorMapping> = [
  // ── 404 — not found ────────────────────────────────────────────────────
  {
    status: 404,
    thrownBy:
      'profiles-browser.ts: readProfile / setActiveProfile / deleteProfile / ' +
      'updateProfileConfig / renameProfile ("Profile not found")',
    test: (m) => m === 'Profile not found',
  },
  {
    status: 404,
    thrownBy:
      'profiles-trash.ts: restoreTrashedProfile / purgeTrashedProfile ' +
      '("Trashed profile not found")',
    test: (m) => m === 'Trashed profile not found',
  },

  // ── 409 — already exists / conflicting state ────────────────────────────
  {
    status: 409,
    thrownBy:
      'profiles-browser.ts: createProfile / profiles-trash.ts: ' +
      'restoreTrashedProfile ("Profile already exists")',
    test: (m) => m === 'Profile already exists',
  },
  {
    status: 409,
    thrownBy: 'profiles-browser.ts: renameProfile ("Target profile already exists")',
    test: (m) => m === 'Target profile already exists',
  },
  {
    status: 409,
    thrownBy: 'profiles-browser.ts: deleteProfile ("Cannot delete the active profile")',
    test: (m) => m === 'Cannot delete the active profile',
  },

  // ── 403 — reserved / protected ───────────────────────────────────────────
  {
    status: 403,
    thrownBy:
      'profiles-browser.ts: validateProfileName ("Default profile cannot be modified here")',
    test: (m) => m === 'Default profile cannot be modified here',
  },
  {
    status: 403,
    thrownBy:
      'profiles-browser.ts: validateProfileName (`Profile name "X" is reserved for built-in agents`)',
    test: (m) => /^Profile name ".*" is reserved for built-in agents$/.test(m),
  },

  // ── 400 — malformed input ────────────────────────────────────────────────
  {
    status: 400,
    thrownBy: 'profiles-browser.ts: validateProfileIdentifier ("Profile name is required")',
    test: (m) => m === 'Profile name is required',
  },
  {
    status: 400,
    thrownBy: 'profiles-browser.ts: validateProfileIdentifier ("Invalid profile name")',
    test: (m) => m === 'Invalid profile name',
  },
  {
    status: 400,
    thrownBy: 'profiles-trash.ts: validateTrashId ("Trash id is required")',
    test: (m) => m === 'Trash id is required',
  },
  {
    status: 400,
    thrownBy: 'profiles-trash.ts: validateTrashId ("Invalid trash id")',
    test: (m) => m === 'Invalid trash id',
  },
  {
    status: 400,
    thrownBy:
      'profiles-export.ts: importProfile ("Unsupported profile bundle schema version")',
    test: (m) => m === 'Unsupported profile bundle schema version',
  },
  {
    status: 400,
    thrownBy:
      'profiles-export.ts: importProfile / assertPlainObject ("Invalid profile bundle" / "Invalid profile bundle: ...")',
    test: (m) => m.startsWith('Invalid profile bundle'),
  },
  {
    status: 400,
    thrownBy:
      'profiles-export.ts: importProfile / validateSkillsRelativePath ("Invalid skills path: ...")',
    test: (m) => m.startsWith('Invalid skills path'),
  },

  // ── 413 — payload too large ──────────────────────────────────────────────
  {
    status: 413,
    thrownBy:
      'profiles-export.ts: collectSkillsTree / importProfile ("Skills tree exceeds export size limit")',
    test: (m) => m === 'Skills tree exceeds export size limit',
  },
]

/** Resolve the HTTP status a caught error should be reported with. */
export function statusForError(error: unknown): number {
  if (!(error instanceof Error)) return 500
  return ERROR_MAPPINGS.find((entry) => entry.test(error.message))?.status ?? 500
}

/**
 * Build the `Response.json({ error }, { status })` a route's catch block
 * should return. Response body shape is unchanged from before this helper
 * existed — clients only ever read `payload.error`.
 */
export function errorResponse(error: unknown, fallbackMessage: string): Response {
  const message = error instanceof Error ? error.message : fallbackMessage
  return Response.json({ error: message }, { status: statusForError(error) })
}
