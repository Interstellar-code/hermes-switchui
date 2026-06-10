// Single source of truth for the displayed website version.
// Astro injects this from the root package.json in astro.config.mjs. The
// fallback is only for unusual non-Astro test contexts.
export const SITE_VERSION =
  import.meta.env.PUBLIC_SITE_VERSION || '2.3.41'
