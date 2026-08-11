/**
 * settings-search.ts — the `/settings` URL contract.
 *
 * The active section used to live in `useState` seeded from the localStorage
 * key `hermes.settings.section`, which meant `/settings` could not be linked
 * to, the back button did nothing, and anything wanting to send a user to a
 * particular section had to *write that localStorage key first* and hope
 * (`inline-approval-card.tsx` really did this). The URL is now the only source
 * of truth.
 *
 * ## Why `?section=` and not `/settings/$section`
 *
 * A param route would shadow the existing static `/settings/providers`, which
 * is a completely different screen, not a section of this one.
 *
 * The sidebar's search text is deliberately *not* in the URL: it changes on
 * every keystroke, and a param that only sometimes reflects the box is worse
 * than one that never claims to.
 *
 * ## Why the default is never written
 *
 * `/settings` must stay bare. `searchForSection` maps the default section to
 * `undefined`, which the router omits from the query string entirely, so
 * spreading the result over the previous search both sets a section and clears
 * it on the way back to the default.
 *
 * This module is pure and router-free so it can be unit tested as one; see
 * `settings-search.test.ts`.
 */

import { z } from 'zod'
import { SECTION_SPEC_BY_ID } from './section-registry'

/** Where `/settings` lands with no params. */
export const DEFAULT_SECTION = 'workspace'

/**
 * TanStack's default search parser runs every raw value through `JSON.parse`
 * first, so a numeric-looking `?q=8642` arrives as the **number** 8642. Coerce
 * before validating, and `.catch(undefined)` so a hand-mangled param degrades
 * to "no param" instead of throwing the route into its error boundary.
 */
export const settingsSearchSchema = z.object({
  /**
   * Section id. Unknown ids are kept here and resolved by `sectionFromSearch`.
   *
   * The union rather than `z.coerce.string()` is deliberate: `coerce` stringifies
   * *anything*, so `?section=null` would decode to the literal string `"null"`
   * and be carried around as if it were a real id.
   */
  section: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .pipe(z.string().min(1))
    .optional()
    .catch(undefined),
})

export type SettingsSearch = z.infer<typeof settingsSearchSchema>

export function isKnownSection(id: string | undefined): boolean {
  return typeof id === 'string' && SECTION_SPEC_BY_ID.has(id)
}

/**
 * URL → active section id. A section that does not exist (a stale bookmark, a
 * renamed id, a typo) falls back to the default rather than rendering an empty
 * panel.
 */
export function sectionFromSearch(
  search: Pick<SettingsSearch, 'section'> | undefined,
): string {
  const id = search?.section
  return isKnownSection(id) ? (id as string) : DEFAULT_SECTION
}

/**
 * Section id → the search patch to spread over the previous search. The default
 * section encodes as `undefined` so `/settings` stays bare.
 */
export function searchForSection(
  sectionId: string,
): Pick<SettingsSearch, 'section'> {
  return {
    section:
      sectionId === DEFAULT_SECTION || !isKnownSection(sectionId)
        ? undefined
        : sectionId,
  }
}
