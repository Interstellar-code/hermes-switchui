/**
 * docs-links.ts — the official Hermes documentation this wizard points at.
 *
 * Collected in one module rather than inlined at each call site because they
 * are about to move: another change is building a local-docs route, and a
 * later pass swaps these live URLs for in-app ones. One constant per topic
 * means that swap is a single edit here, not a grep across eight step bodies.
 *
 * Every URL below was checked against the docs source that ships locally at
 * `~/.hermes/hermes-agent/website/docs/`, which is byte-identical to the live
 * site — so a link here corresponds to a file we can see, not to a page we
 * hope exists.
 */
const BASE = 'https://hermes-agent.nousresearch.com/docs'

export const DOCS = {
  /** getting-started/quickstart.md — install → provider → first chat. */
  quickstart: `${BASE}/getting-started/quickstart`,
  /** integrations/providers.md — every provider, and the context-window rules. */
  providers: `${BASE}/integrations/providers`,
  /** guides/local-ollama-setup.md — including the `num_ctx` trap. */
  ollama: `${BASE}/guides/local-ollama-setup`,
  /** reference/faq.md — "Ollama reports max context, not effective num_ctx". */
  faq: `${BASE}/reference/faq`,
  /** user-guide/profiles.md — profiles as separate agent identities. */
  profiles: `${BASE}/user-guide/profiles`,
  /** user-guide/features/memory.md. */
  memory: `${BASE}/user-guide/features/memory`,
  /** user-guide/features/mcp.md. */
  mcp: `${BASE}/user-guide/features/mcp`,
  /** user-guide/features/skills.md. */
  skills: `${BASE}/user-guide/features/skills`,
  /** developer-guide/gateway-internals.md — what the gateway reads at boot. */
  gateway: `${BASE}/developer-guide/gateway-internals`,
} as const

export type DocsTopic = keyof typeof DOCS
