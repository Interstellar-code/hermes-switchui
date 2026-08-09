/**
 * yaml-preview.ts — renders the literal config.yaml fragment a provider save
 * is about to write, for display on the Review step. Pure and separate from
 * the write path so the preview cannot drift from what the user was shown —
 * the previous wizard wrote a shape (`auth.profiles.*`) nothing read, to a
 * route that did not exist, and nothing surfaced that mismatch until write
 * time.
 */
export function buildYamlPreview(input: {
  id: string
  baseUrl: string
  envKey: string
  makeActive: boolean
  defaultModel: string
  inline: boolean
  /** The recovery path also writes the key inline; show that. */
  inlineFallback?: boolean
}): string {
  if (input.inline) {
    return [
      'model:',
      `  provider: ${input.id}`,
      input.baseUrl ? `  base_url: ${input.baseUrl}` : null,
      input.defaultModel ? `  default: ${input.defaultModel}` : null,
      '  api_key: ********',
    ]
      .filter(Boolean)
      .join('\n')
  }

  // No `type:` line — the gateway reads no such key off a providers entry, and
  // showing it in the preview taught users a field that does nothing.
  //
  // No `providers:` block at all without a base URL: that is a gateway
  // built-in, which is configured by its env key plus `model.provider` and
  // ignores a user entry of the same name. Previewing an empty `openrouter:`
  // key promised a write that would not happen. See write-paths.ts.
  const lines = input.baseUrl
    ? [
        'providers:',
        `  ${input.id}:`,
        `    base_url: ${input.baseUrl}`,
        input.envKey ? `    key_env: ${input.envKey}` : null,
        input.inlineFallback ? '    api_key: ********' : null,
      ].filter(Boolean)
    : [input.envKey ? `~/.hermes/.env → ${input.envKey}` : null].filter(Boolean)

  if (input.makeActive) {
    lines.push(
      'model:',
      `  provider: ${input.id}`,
      `  default: ${input.defaultModel || 'auto'}`,
    )
  }
  return lines.join('\n')
}
