// Single source of truth for the displayed site version.
// Injected at build time by the root `build:website` script
// (PUBLIC_SITE_VERSION=$(node -p "require('./package.json').version")).
// The fallback keeps a sane value when the site is built directly
// (e.g. `astro build`) without the env var set.
export const SITE_VERSION =
  import.meta.env.PUBLIC_SITE_VERSION || '2.3.29'
