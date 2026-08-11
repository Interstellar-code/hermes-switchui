/**
 * `/settings` — the Settings screen, with its active section in the URL.
 *
 * `validateSearch` belongs **here and not on `src/routes/settings.tsx`**: that
 * is the layout route, and `/settings/providers` — an entirely different screen
 * — inherits from it. Nor is this a `/settings/$section` param route, which
 * would shadow that same static sibling.
 *
 * The encode/decode rules live in `lib/settings-search.ts` so they can be unit
 * tested without a router.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { SettingsScreen } from '@/screens/settings/settings-screen'
import {
  searchForSection,
  sectionFromSearch,
  settingsSearchSchema,
} from '@/screens/settings/lib/settings-search'

export const Route = createFileRoute('/settings/')({
  ssr: false,
  validateSearch: settingsSearchSchema,
  component: SettingsRoute,
})

function SettingsRoute() {
  const search = Route.useSearch()
  const navigate = useNavigate()

  return (
    <SettingsScreen
      section={sectionFromSearch(search)}
      onSectionChange={(id) => {
        // `searchForSection` maps the default section to `undefined`, which the
        // router omits entirely — so `/settings` stays bare and going back to
        // the default clears the param instead of writing `?section=workspace`.
        void navigate({
          to: '/settings',
          search: (prev) => ({ ...prev, ...searchForSection(id) }),
        })
      }}
    />
  )
}
