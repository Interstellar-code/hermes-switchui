/**
 * Secret masking for a profile's `config.yaml`, shared by every place that
 * shows or hands out that config: the wizard's read-only preview, the detail
 * drawer's Config tab, and — the reason this has to be strict — the profile
 * **export** bundle in `src/server/profiles-export.ts`, which exists to be
 * handed to somebody else.
 *
 * The original rule was `/^(api_?key|secret|token|password|authorization)$/i`:
 * anchored and exact. It masked `api_key` and missed literally every real key
 * name — `OPENAI_API_KEY`, `GITHUB_TOKEN`, `BRAVE_API_KEY`,
 * `ANTHROPIC_AUTH_TOKEN`, `AWS_SECRET_ACCESS_KEY` — because a prefix defeats
 * the anchor. `mcp-server-list.tsx` collects `GITHUB_TOKEN` and
 * `BRAVE_API_KEY` straight into the `mcp_servers.<name>.env` map that export
 * serialises, so that gap was a live leak the moment export shipped.
 *
 * Two independent layers now:
 *
 *  1. **Key names** (`isSecretKeyName`) — word-aware substring matching, with
 *     an explicit exemption list so fields that merely *name* a secret stay
 *     readable. `key_env: CUSTOM_API_KEY` is the canonical case: masking it
 *     would hide which environment variable the provider reads from, which is
 *     the single most useful line in the preview.
 *  2. **Value shapes** (`looksLikeSecretValue`) — defence in depth for a
 *     secret hiding under an unguessable key name. Only unambiguous signals
 *     count, because a false positive here mangles a legitimate value: a
 *     `base_url`, a model id, a filesystem path and a UUID all have to survive
 *     untouched.
 *
 * No `node:` imports — this runs in the browser bundle (via
 * `profile-config-map.ts`) and in server code (via `profiles-export.ts`).
 */

// ── Key-name analysis ────────────────────────────────────────────────────────

/**
 * Split a key into lowercase words across `_`, `-`, `.`, whitespace and
 * camelCase boundaries. `OPENAI_API_KEY` → `['openai','api','key']`,
 * `clientSecret` → `['client','secret']`, `AWSSecretKey` →
 * `['aws','secret','key']`.
 *
 * Word-awareness is what makes "substring, not exact match" safe: matching the
 * *word* `key` catches `OPENAI_API_KEY` and `x-api-key` without also catching
 * `keyboard_layout` or `monkey_patch`.
 */
export function keyWords(key: string): Array<string> {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase())
}

/**
 * Substrings that make a key a secret. Matched against the key with every
 * separator removed, so `accessToken`, `access_token` and `ACCESSTOKEN` all
 * hit `token`. No legitimate non-secret config field is called "…secret…" or
 * "…password…".
 */
const SECRET_SUBSTRINGS = [
  'secret',
  'token',
  'password',
  'passwd',
  'passphrase',
  'credential',
  'authorization',
  'bearer',
]

/**
 * Secret compounds that carry no separator to split on, so the word rule below
 * cannot see the `key` inside them. Matched against each *word* rather than
 * the collapsed name, so `APIKEY` matches while `access_key_id` — which
 * collapses to `accesskeyid` — is still judged word by word and can be
 * exempted as an identifier.
 */
const SECRET_COMPOUND_WORDS = [
  'apikey',
  'privatekey',
  'accesskey',
  'signingkey',
  'sessionkey',
  'encryptionkey',
]

/**
 * Words that mean "secret" in context: `key` is a secret, and `key` inside
 * `OPENAI_API_KEY` or `x-api-key` is the same secret.
 */
const WEAK_SECRET_WORDS = new Set(['key', 'keys', 'auth', 'cred', 'creds', 'pwd'])

/**
 * Trailing qualifiers that turn a secret-sounding name into a *reference to* a
 * secret rather than the secret itself. A key ending in one of these is never
 * masked on its name alone — the value-shape layer is the backstop if someone
 * parks a real credential in one. Every entry earns its place:
 *
 * - `env`, `var`, `vars`, `variable` — the value is an environment variable
 *   NAME. This is the case the old implementation exempted by hand and the one
 *   that matters most: `providers.manifest.key_env: CUSTOM_API_KEY` is how the
 *   gateway is told where to find the key, and a masked `CUST…••••` there
 *   makes the config preview actively misleading — the user can no longer see
 *   which variable to set.
 * - `name` — `key_name`, `credential_name`: a label used to select a
 *   credential from a store, not the credential.
 * - `id`, `ids` — the public identifier half of a key pair (`access_key_id`,
 *   `private_key_id`), which exists precisely so keys can be told apart in
 *   logs and consoles. An actual `AKIA…` sitting in one is still masked, by
 *   {@link looksLikeSecretValue}'s vendor-prefix rule.
 * - `file`, `filename`, `path`, `dir` — `key_file`, `credential_path`: a
 *   filesystem location. Masking it hides where to look and reveals nothing.
 * - `ref` — `key_ref`: an indirection handle into some external store.
 * - `type`, `mode`, `scheme` — `auth_type: bearer`, `key_type: rsa`: a mode
 *   selector, and one the user needs to see to debug a provider.
 * - `enabled`, `required` — `auth_enabled: true`: a boolean switch.
 *
 * Only a TRAILING qualifier exempts. `key_env` names an environment variable;
 * `env_key` is a key that merely lives in an env map, and `name_key` is still
 * a key.
 *
 * Deliberately NOT exempt: `url`/`uri` (a `credential_url` can carry inline
 * credentials) and `header` (`auth_header` may hold the literal header value).
 */
const EXEMPT_QUALIFIER_WORDS = new Set([
  'env',
  'var',
  'vars',
  'variable',
  'name',
  'id',
  'ids',
  'file',
  'filename',
  'path',
  'dir',
  'ref',
  'type',
  'mode',
  'scheme',
  'enabled',
  'required',
])

/**
 * Key words that mean "this long hex/base64 run is a digest or an identifier,
 * not a credential". Suppresses only the entropy heuristics in
 * {@link looksLikeSecretValue}; a `sk-…`/`ghp_…`-style value under one of
 * these is still masked, because a vendor key prefix is never a hash.
 */
const DIGEST_KEY_WORDS = new Set([
  'sha',
  'sha1',
  'sha256',
  'sha512',
  'md5',
  'hash',
  'digest',
  'checksum',
  'etag',
  'commit',
  'revision',
  'rev',
  'uuid',
  'guid',
  'id',
  'fingerprint',
  'version',
])

/**
 * Does this key name mean its string value is a secret?
 *
 * A trailing {@link EXEMPT_QUALIFIER_WORDS} qualifier wins outright; otherwise
 * any secret substring, secret compound word, or secret word masks.
 */
export function isSecretKeyName(key: string): boolean {
  const words = keyWords(key)
  if (words.length === 0) return false
  if (EXEMPT_QUALIFIER_WORDS.has(words[words.length - 1])) return false

  const collapsed = words.join('')
  if (SECRET_SUBSTRINGS.some((needle) => collapsed.includes(needle))) return true
  if (words.some((word) => SECRET_COMPOUND_WORDS.some((c) => word.includes(c)))) return true
  return words.some((word) => WEAK_SECRET_WORDS.has(word))
}

// ── Value-shape analysis ─────────────────────────────────────────────────────

/**
 * `${VAR}` / `$VAR`. A reference, not a secret — and the same carve-out
 * `maskSecretsInPlace` in `src/server/mcp-normalize.ts` already makes, so the
 * two masking paths agree about what an env reference is. Masking it would
 * destroy the only useful information the field carries.
 */
const ENV_REF_RE = /^\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)$/

/** Canonical hyphenated UUID — an identifier, never masked by shape. */
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/**
 * Vendor-issued credential formats. Each has a registered prefix that nothing
 * else in a config file uses, so these fire regardless of key name and
 * regardless of the digest/identifier guards. Length floors are set well below
 * the real formats but well above anything a prefix collision could reach.
 *
 * Matched anywhere in the string (behind a non-alphanumeric boundary) so
 * `Authorization: Bearer sk-…`-style composite values are caught too.
 */
const VENDOR_SECRET_PATTERNS: Array<RegExp> = [
  // OpenAI (`sk-`, `sk-proj-`) and Anthropic (`sk-ant-api03-`).
  /(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/,
  // GitHub personal/OAuth/app/refresh tokens.
  /(^|[^A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}/,
  /(^|[^A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}/,
  // Slack bot/user/app tokens.
  /(^|[^A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{10,}/,
  // AWS access key id.
  /(^|[^A-Za-z0-9])AKIA[0-9A-Z]{12,}/,
  // Google API key.
  /(^|[^A-Za-z0-9])AIza[A-Za-z0-9_-]{30,}/,
  // Any PEM private key pasted inline.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]

/** 32+ hex characters of a single case: an API secret, a digest, or nothing. */
const LONG_HEX_RE = /^(?:[0-9a-f]{32,}|[0-9A-F]{32,})$/

/**
 * 40+ base64url characters. `+` and `/` are deliberately excluded from the
 * charset: including `/` would make every sufficiently long filesystem path a
 * candidate, and modern tokens are overwhelmingly base64url anyway.
 */
const BASE64URL_RE = /^[A-Za-z0-9_-]{40,}={0,2}$/

/** Shannon entropy in bits per character. */
function shannonEntropy(value: string): number {
  const counts = new Map<string, number>()
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1)
  let entropy = 0
  for (const count of counts.values()) {
    const p = count / value.length
    entropy -= p * Math.log2(p)
  }
  return entropy
}

/** Minimum bits/char for a base64url run to read as random rather than as text. */
const MIN_BASE64_ENTROPY = 3.0

/**
 * Does this string value look like a credential on its own, ignoring the key
 * it sits under?
 *
 * Two tiers, mirroring the key rule:
 *
 *  - **Vendor prefixes** — unconditional. A `ghp_…` is a GitHub token no
 *    matter what it is called.
 *  - **Entropy** — a 32+ char single-case hex run, or a 40+ char base64url run
 *    that mixes upper, lower and digits and clears
 *    {@link MIN_BASE64_ENTROPY}. Suppressed when `key` is digest- or
 *    identifier-shaped (`sha`, `etag`, `commit`, `uuid`, …), since those hold
 *    exactly the same character shape by design.
 *
 * False-positive guards, all exercised in the tests: a `base_url` and any
 * POSIX path contain `/` or `.` and cannot match either regex; a model id such
 * as `claude-opus-4-20250514` is far short of 40 characters; a hyphenated UUID
 * is rejected outright and is under the length floor besides; an env-var name
 * like `CUSTOM_API_KEY` has no lowercase; a long lowercase prose string has no
 * uppercase or digits.
 */
export function looksLikeSecretValue(value: string, key?: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0) return false
  if (ENV_REF_RE.test(trimmed)) return false

  if (VENDOR_SECRET_PATTERNS.some((pattern) => pattern.test(trimmed))) return true

  if (UUID_RE.test(trimmed)) return false
  if (key !== undefined && keyWords(key).some((word) => DIGEST_KEY_WORDS.has(word))) {
    return false
  }

  if (LONG_HEX_RE.test(trimmed)) return true

  if (BASE64URL_RE.test(trimmed)) {
    const hasLower = /[a-z]/.test(trimmed)
    const hasUpper = /[A-Z]/.test(trimmed)
    const hasDigit = /[0-9]/.test(trimmed)
    if (hasLower && hasUpper && hasDigit && shannonEntropy(trimmed) >= MIN_BASE64_ENTROPY) {
      return true
    }
  }

  return false
}

// ── Masking ──────────────────────────────────────────────────────────────────

const MASK_SUFFIX = '…••••'

/**
 * Keep a short prefix so the value stays recognisable ("which key is this?"),
 * but never more than a third of it — the old flat `slice(0, 6)` handed over
 * six of the eight characters of a short secret, which is not masking.
 */
export function maskSecretString(value: string): string {
  if (value.length === 0) return value
  const keep = Math.min(6, Math.floor(value.length / 3))
  return value.slice(0, keep) + MASK_SUFFIX
}

function maskValue(value: unknown, key: string | undefined): unknown {
  if (Array.isArray(value)) {
    // Arrays inherit their parent key: `tokens: [...]` is a list of tokens.
    return value.map((item) => maskValue(item, key))
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      result[childKey] = maskValue(childValue, childKey)
    }
    return result
  }
  if (typeof value !== 'string') return value

  // An env reference is never masked, whatever it is called — it is the name
  // of the thing holding the secret, not the secret.
  if (ENV_REF_RE.test(value.trim())) return value

  if (key !== undefined && isSecretKeyName(key)) return maskSecretString(value)
  if (looksLikeSecretValue(value, key)) return maskSecretString(value)
  return value
}

/**
 * Deep-copy `obj`, replacing secret-shaped strings with a truncated + masked
 * form (`"sk-ab12…"` → `"sk-ab1…••••"`).
 *
 * Recurses through nested objects AND arrays, so `mcp_servers.<name>.env.*` —
 * where the wizard puts `GITHUB_TOKEN` and `BRAVE_API_KEY` — is reached. The
 * input is never mutated: every object and array on the path is rebuilt.
 *
 * Non-string values pass through untouched. A secret is a string in every
 * shape this config can take, and coercing a number or boolean into a masked
 * string would change the type of the config the user is reading.
 */
export function maskSecrets(obj: unknown): unknown {
  return maskValue(obj, undefined)
}
