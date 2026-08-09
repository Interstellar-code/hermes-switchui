/**
 * docs-links.ts — the official Hermes documentation this wizard points at.
 *
 * Collected in one module rather than inlined at each call site so a change
 * to where these point is a single edit here, not a grep across eight step
 * bodies.
 *
 * ## Local docs now exist — this module is a half-finished handoff
 *
 * `GET /api/hermes-docs?path=<relative>` (`src/routes/api/hermes-docs.ts`)
 * now serves these same docs straight out of the installed hermes-agent
 * checkout at `~/.hermes/hermes-agent/website/docs/`, and returns a
 * `liveUrl` fallback in every response — including a 200 (not an error) when
 * the local checkout is simply absent. `HermesDocsLink`
 * (`src/components/hermes-docs-link.tsx`) is the client for it: give it a
 * `path` and it renders the local content with the live link underneath,
 * already wired up in the settings sections (`section-execution.tsx`,
 * `section-gateway.tsx`).
 *
 * The onboarding step files still consume `DOCS.topic` as a bare string for
 * a plain `<a href target="_blank">` (`welcome-step.tsx`, `provider-step.tsx`,
 * `connect-step.tsx`, `chat-step.tsx`, and `../lib/extras.ts`'s `docs` field).
 * Swapping those over to `<HermesDocsLink path={DOCS_PATHS.topic} />` is real
 * behavior change in files this module does not own, so it is not done here
 * — `DOCS` keeps exporting the live URL unchanged for those call sites.
 * `DOCS_PATHS` below is the relative-path half of that swap, ready to use.
 *
 * Every path was checked against the docs source that ships locally at
 * `~/.hermes/hermes-agent/website/docs/` (byte-identical to the live site),
 * so a link here corresponds to a file that exists, not a page we hope
 * exists. All nine still resolve as of this pass.
 */
const BASE = 'https://hermes-agent.nousresearch.com/docs'

/** Paths relative to the local docs root, for `HermesDocsLink`/`/api/hermes-docs`. */
export const DOCS_PATHS = {
  quickstart: 'getting-started/quickstart.md',
  providers: 'integrations/providers.md',
  ollama: 'guides/local-ollama-setup.md',
  faq: 'reference/faq.md',
  profiles: 'user-guide/profiles.md',
  memory: 'user-guide/features/memory.md',
  mcp: 'user-guide/features/mcp.md',
  skills: 'user-guide/features/skills.md',
  gateway: 'developer-guide/gateway-internals.md',
} as const satisfies Record<string, string>

export type DocsTopic = keyof typeof DOCS_PATHS

/** `DOCS_PATHS` value → the live-site URL, mirroring `hermesDocsLiveUrl` in `server/hermes-docs.ts`. */
function liveUrlFor(relativePath: string): string {
  return `${BASE}/${relativePath.replace(/\.mdx?$/i, '')}`
}

/**
 * Live URL per topic — unchanged in value from before this pass, and still
 * what every current onboarding call site reads as a plain `href`. Derived
 * from `DOCS_PATHS` (rather than kept as separate literals) so the two can
 * no longer drift the way `docs-links.ts` and its consumers otherwise would.
 */
export const DOCS: Record<DocsTopic, string> = Object.fromEntries(
  Object.entries(DOCS_PATHS).map(([topic, path]) => [topic, liveUrlFor(path)]),
) as Record<DocsTopic, string>
