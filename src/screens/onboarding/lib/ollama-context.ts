/**
 * ollama-context.ts — catch the 2048-token default *before* the first chat.
 *
 * The official docs call this out in four separate places, and it is the
 * single most common source of local-model confusion:
 *
 *   - `getting-started/quickstart.md:150` — "Hermes Agent requires a model with
 *     at least 64,000 tokens of context … will be rejected at startup."
 *   - `guides/local-ollama-setup.md:159` — "By default, Ollama uses a
 *     2048-token context."
 *   - `integrations/providers.md:673` — smaller windows are rejected at
 *     startup, with the three fixes (`OLLAMA_CONTEXT_LENGTH`, a `num_ctx`
 *     Modelfile, or `context_length` in the Hermes provider entry).
 *   - `reference/faq.md:83` — and the trap that makes live probing useless:
 *     "Ollama's `/api/show` reports the model's *maximum* context, not the
 *     effective `num_ctx` you configured."
 *
 * That last line is why this module reads the **Hermes config entry** rather
 * than asking Ollama. Ollama cannot tell us the effective window, and
 * `OLLAMA_CONTEXT_LENGTH` lives in the environment of a process this browser
 * cannot see. What we *can* read is what the user told Hermes, and Hermes is
 * the thing that rejects the model — so `context_length` is both the signal
 * and the fix.
 *
 * The verdict is deliberately a warning, never a block. A user who exported
 * `OLLAMA_CONTEXT_LENGTH=64000` has a working setup with nothing in
 * `config.yaml` to prove it, and refusing to let them continue on the strength
 * of a value we admit we cannot see would be worse than the confusion this
 * exists to prevent.
 */

/** `integrations/providers.md:673` — rejected at startup below this. */
export const HERMES_MIN_CONTEXT_TOKENS = 64_000

/** `guides/local-ollama-setup.md:159`. */
export const OLLAMA_DEFAULT_NUM_CTX = 2_048

export type OllamaContextVerdict = {
  /**
   * `not-applicable` — this provider is not a local Ollama-style runtime.
   * `ok`             — a `context_length` at or above the minimum is configured.
   * `below-minimum`  — a `context_length` is configured and it is too small.
   * `unconfigured`   — an Ollama provider with no `context_length` at all, so
   *                    the runtime default (2048) applies unless an env var we
   *                    cannot read says otherwise.
   */
  kind: 'not-applicable' | 'ok' | 'below-minimum' | 'unconfigured'
  /** The value found in config, when there was one. */
  contextLength: number | null
  /** One sentence, ready to render. Empty for `not-applicable`. */
  message: string
  /** The concrete fixes, in the order the docs recommend them. */
  fixes: Array<string>
}

const NOT_APPLICABLE: OllamaContextVerdict = {
  kind: 'not-applicable',
  contextLength: null,
  message: '',
  fixes: [],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * Is this an Ollama endpoint? The provider id is the strong signal; the base
 * URL is the fallback, because an OpenAI-compatible entry pointed at :11434 is
 * an Ollama in every way that matters here and is how most people wire it.
 */
export function isOllamaEndpoint(input: {
  providerId?: string | null
  baseUrl?: string | null
}): boolean {
  const id = (input.providerId ?? '').trim().toLowerCase()
  if (id === 'ollama') return true
  const url = (input.baseUrl ?? '').trim().toLowerCase()
  if (!url) return false
  return url.includes('ollama') || url.includes(':11434')
}

/**
 * Pull `context_length` for one provider out of a raw `config.yaml` payload.
 *
 * Three shapes, all of them real: the `providers:` map, the legacy
 * `custom_providers` list (or map), and the inline `model:` block. Returns
 * `null` when none of them names one — which is the interesting case, not a
 * parse failure.
 */
export function readConfiguredContextLength(
  config: unknown,
  providerId: string,
): number | null {
  if (!isRecord(config) || !providerId) return null
  const target = providerId.trim().toLowerCase()

  const providers = config.providers
  if (isRecord(providers)) {
    for (const [id, entry] of Object.entries(providers)) {
      if (id.trim().toLowerCase() !== target || !isRecord(entry)) continue
      const found = num(entry.context_length ?? entry.contextLength)
      if (found !== null) return found
    }
  }

  const custom = config.custom_providers
  const customEntries: Array<unknown> = Array.isArray(custom)
    ? custom
    : isRecord(custom)
      ? Object.values(custom)
      : []
  for (const entry of customEntries) {
    if (!isRecord(entry)) continue
    const id = String(entry.id ?? entry.name ?? '')
      .trim()
      .toLowerCase()
    if (id !== target) continue
    const found = num(entry.context_length ?? entry.contextLength)
    if (found !== null) return found
  }

  const model = config.model
  if (isRecord(model)) {
    const owner = String(model.provider ?? '')
      .trim()
      .toLowerCase()
    if (owner === target) {
      const found = num(model.context_length ?? model.contextLength)
      if (found !== null) return found
    }
  }

  return null
}

export function detectOllamaContext(input: {
  providerId?: string | null
  baseUrl?: string | null
  /** The raw `config.yaml` payload from `/api/claude-config`. */
  config?: unknown
  /**
   * Whether local discovery currently sees Ollama running. Only used to keep
   * the wizard quiet about a provider that is not even up — an offline Ollama
   * has a louder problem than its context window.
   */
  online?: boolean | null
}): OllamaContextVerdict {
  if (!isOllamaEndpoint(input)) return NOT_APPLICABLE
  if (input.online === false) return NOT_APPLICABLE

  const providerId = (input.providerId ?? '').trim() || 'ollama'
  const contextLength = readConfiguredContextLength(input.config, providerId)

  const fixes = [
    `Start the server with a bigger window: OLLAMA_CONTEXT_LENGTH=${HERMES_MIN_CONTEXT_TOKENS} ollama serve`,
    `Or bake it into the model: a Modelfile with PARAMETER num_ctx ${HERMES_MIN_CONTEXT_TOKENS}, then ollama create`,
    `Or declare it to Hermes: context_length: ${HERMES_MIN_CONTEXT_TOKENS} on this provider in config.yaml`,
  ]

  if (contextLength === null) {
    return {
      kind: 'unconfigured',
      contextLength: null,
      message:
        `This provider declares no context_length, so Hermes assumes whatever Ollama serves — ` +
        `and Ollama's default is ${OLLAMA_DEFAULT_NUM_CTX.toLocaleString()} tokens. Hermes needs at least ` +
        `${HERMES_MIN_CONTEXT_TOKENS.toLocaleString()} for tool-calling and rejects smaller windows at startup. ` +
        `Ollama's /api/show reports the model's maximum, not the window it is actually serving, so this ` +
        `cannot be detected — only declared.`,
      fixes,
    }
  }

  if (contextLength < HERMES_MIN_CONTEXT_TOKENS) {
    return {
      kind: 'below-minimum',
      contextLength,
      message:
        `context_length is set to ${contextLength.toLocaleString()} tokens, below the ` +
        `${HERMES_MIN_CONTEXT_TOKENS.toLocaleString()} Hermes requires for agentic work. The gateway rejects ` +
        `models under that limit at startup, so the first chat will fail.`,
      fixes,
    }
  }

  return {
    kind: 'ok',
    contextLength,
    message: `context_length is ${contextLength.toLocaleString()} tokens, at or above the Hermes minimum.`,
    fixes: [],
  }
}

/** Does this verdict warrant a warning before the first chat is attempted? */
export function shouldWarnBeforeChat(verdict: OllamaContextVerdict): boolean {
  return verdict.kind === 'below-minimum' || verdict.kind === 'unconfigured'
}
