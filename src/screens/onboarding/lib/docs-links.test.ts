import { describe, expect, it } from 'vitest'
import { DOCS, DOCS_PATHS } from './docs-links'

describe('DOCS_PATHS', () => {
  it('matches the relative paths verified against the real docs tree', () => {
    // `~/.hermes/hermes-agent/website/docs/<path>` for each of these
    // resolved to a real file as of this pass — see the module header.
    expect(DOCS_PATHS).toEqual({
      quickstart: 'getting-started/quickstart.md',
      providers: 'integrations/providers.md',
      ollama: 'guides/local-ollama-setup.md',
      faq: 'reference/faq.md',
      profiles: 'user-guide/profiles.md',
      memory: 'user-guide/features/memory.md',
      mcp: 'user-guide/features/mcp.md',
      skills: 'user-guide/features/skills.md',
      gateway: 'developer-guide/gateway-internals.md',
    })
  })
})

describe('DOCS', () => {
  it('derives the same live URLs the hardcoded map used before, unchanged', () => {
    // These are the exact hrefs the onboarding step files render today —
    // pinned so a `DOCS_PATHS` edit (or a change to the `.md`-stripping
    // transform) cannot silently change what a live user's browser opens.
    expect(DOCS).toEqual({
      quickstart:
        'https://hermes-agent.nousresearch.com/docs/getting-started/quickstart',
      providers:
        'https://hermes-agent.nousresearch.com/docs/integrations/providers',
      ollama:
        'https://hermes-agent.nousresearch.com/docs/guides/local-ollama-setup',
      faq: 'https://hermes-agent.nousresearch.com/docs/reference/faq',
      profiles:
        'https://hermes-agent.nousresearch.com/docs/user-guide/profiles',
      memory:
        'https://hermes-agent.nousresearch.com/docs/user-guide/features/memory',
      mcp: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp',
      skills:
        'https://hermes-agent.nousresearch.com/docs/user-guide/features/skills',
      gateway:
        'https://hermes-agent.nousresearch.com/docs/developer-guide/gateway-internals',
    })
  })

  it('every topic has a matching DOCS_PATHS entry', () => {
    expect(Object.keys(DOCS).sort()).toEqual(Object.keys(DOCS_PATHS).sort())
  })
})
