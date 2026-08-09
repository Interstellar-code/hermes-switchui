/**
 * Single source of truth for profile-name rules (P-09).
 *
 * Before this module there were three disagreeing rules: the on-disk constant
 * in `server/profiles-browser.ts` (declared and never used), the create
 * wizard's `/^[a-z0-9-]{2,40}$/`, and the rename dialog's
 * `/^[A-Za-z0-9_-]+$/`. The write path enforced none of them, so the API would
 * happily `mkdir` a profile called `My Agent!!`.
 *
 * IMPORTANT: this module must stay importable from BOTH server and browser
 * code — no `node:` imports, no filesystem access, no environment lookups.
 */

/** Lifecycle-independent name shape allowed to exist on disk. */
export type ProfileNameRuleset = 'canonical' | 'wizard'

/**
 * The canonical on-disk rule — the widest set of names the server will
 * create, rename to, or otherwise write.
 *
 * It is deliberately looser than {@link WIZARD_NAME_RE} because it must keep
 * accepting every profile directory that already exists, including the
 * built-ins (`hermes-switch`, `neo`, `trinity`, `morpheus`) and legacy
 * underscore-separated names. Tightening this regex would make already-created
 * profiles unwritable.
 *
 * Shape: must start with a lowercase letter or digit, then up to 63 more
 * lowercase letters, digits, hyphens or underscores (64 characters total).
 */
export const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** Maximum length accepted by {@link PROFILE_NAME_RE}. */
export const PROFILE_NAME_MAX_LENGTH = 64

/** User-facing explanation of {@link PROFILE_NAME_RE}. */
export const PROFILE_NAME_MESSAGE =
  'Name must start with a lowercase letter or number and use only lowercase letters, numbers, hyphens or underscores (max 64 characters)'

/**
 * The tighter rule offered for NEW names by the create wizard and the clone
 * dialog. Every name it accepts also satisfies {@link PROFILE_NAME_RE}, so a
 * name that passes here always passes the server's write-path check.
 */
export const WIZARD_NAME_RE = /^[a-z0-9-]{2,40}$/

/** Maximum length accepted by {@link WIZARD_NAME_RE}; also the sanitiser clamp. */
export const WIZARD_NAME_MAX_LENGTH = 40

/**
 * The message the wizard and clone dialog already show. Kept verbatim (en
 * dash included) so lifting those inline checks onto this module is a no-op
 * for the UI copy.
 */
export const WIZARD_NAME_MESSAGE =
  'Name must be 2–40 lowercase letters, numbers, or hyphens'

/** Message used when the field is empty — matches the server's own wording. */
export const PROFILE_NAME_REQUIRED_MESSAGE = 'Profile name is required'

/** True when `name` satisfies the canonical on-disk rule. */
export function isValidProfileName(name: string): boolean {
  return PROFILE_NAME_RE.test(name.trim())
}

/** True when `name` satisfies the tighter rule offered for new names. */
export function isValidWizardProfileName(name: string): boolean {
  return WIZARD_NAME_RE.test(name.trim())
}

/**
 * User-facing validation message for `name`, or `null` when it is acceptable.
 *
 * Pass `ruleset: 'wizard'` on creation surfaces (wizard identity step, clone
 * dialog) and leave it at the default `'canonical'` anywhere an existing name
 * is being checked.
 */
export function profileNameError(
  name: string,
  ruleset: ProfileNameRuleset = 'canonical',
): string | null {
  const trimmed = name.trim()
  if (!trimmed) return PROFILE_NAME_REQUIRED_MESSAGE
  if (ruleset === 'wizard') {
    return WIZARD_NAME_RE.test(trimmed) ? null : WIZARD_NAME_MESSAGE
  }
  return PROFILE_NAME_RE.test(trimmed) ? null : PROFILE_NAME_MESSAGE
}

/**
 * Coerce arbitrary user input into a wizard-shaped name: lowercase, runs of
 * disallowed characters folded to a single hyphen, no leading/trailing hyphen,
 * clamped to {@link WIZARD_NAME_MAX_LENGTH}.
 *
 * Folding to `-` rather than deleting preserves word boundaries, which is what
 * the clone dialog's `${name}-copy` seed and the identity step's
 * slugify-as-you-type both want (`My Agent` → `my-agent`, not `myagent`).
 *
 * The result can still be invalid — an all-punctuation input sanitises to `''`
 * and a single character fails the wizard's 2-char minimum — so callers must
 * still run {@link profileNameError} on it.
 */
export function sanitizeProfileName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, WIZARD_NAME_MAX_LENGTH)
    .replace(/-+$/, '')
}
