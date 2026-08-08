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

  const lines = [
    'providers:',
    `  ${input.id}:`,
    '    type: openai',
    input.baseUrl ? `    base_url: ${input.baseUrl}` : null,
    input.envKey ? `    key_env: ${input.envKey}` : null,
  ].filter(Boolean)

  if (input.makeActive) {
    lines.push(
      'model:',
      `  provider: ${input.id}`,
      `  default: ${input.defaultModel || 'auto'}`,
    )
  }
  return lines.join('\n')
}
