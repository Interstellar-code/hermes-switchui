# Changelog

All notable changes to Switch UI are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.5.38] — 2026-08-23

### Fixed

- **The Setup Checklist Still Could Not Tell The Truth About Four Steps**: 2.5.37 gave the checklist live probes; these are the four items that stayed wrong regardless of what you did. **"Pick a theme" completed itself for every install on its first page load** — boot-time appearance setup ran `setTheme(getTheme())`, which writes the *default* theme to storage when nothing is stored, destroying the one distinction that separates "chose Matrix" from "never opened the picker". Painting a theme and choosing one are now different operations. **A theme picked in the current tab was invisible** until reload: `storage` events reach every tab except the writer, and the theme control opens in a dialog *over* the dashboard card, so there was no remount to fall back on either. **"Review core plugins" could not end in "no"** — it was satisfied only by all seven core plugins being enabled at once, so anyone who opened the catalogue and deliberately left one off was told forever that a review was outstanding, clearable only by enabling the plugin they had just rejected.
- **A Stopped Gateway Erased A Configured Install**: `/api/claude-config` blanked its whole payload behind a gateway capability flag, yet every field it returns is read off local disk by this process — `config.yaml`, `.env`, `auth.json`. A user with a wired provider and a `memory:` block was told they had neither the moment the gateway stopped, which is precisely when the checklist's advice is least checkable. The flag now annotates the response instead of emptying it, and `ok` stays true: a caller writing the obvious `if (!payload.ok) return` would otherwise discard a config it can act on, reinstating the defect one layer up.

### Changed

- **Update Confirmations Say What Will Happen**: Both update surfaces asked through the browser's native `window.confirm`, unthemed and blocking, with the copy built inline in each. "Update Workspace from 8ade871 to f43cec1?" states the one thing you can already see and omits the one you cannot — an Agent update restarts the gateway and interrupts running sessions; a workspace update rebuilds the checkout and needs a restart. The consequence is now in the message, the button matches the action ("Download" when it only fetches, "Install & restart" when it does not), and both surfaces read from one source rather than drifting apart again.

## [2.5.37] — 2026-08-14

### Added

- **Hermes' Commands, In The Composer**: The picker hardcoded thirteen commands against a registry of 156, and two of the thirteen — `/mcp` and `/help` — had no handler at all, so typing them sent the literal text to the model as prose. It is now built from the agent's live catalog: **14 agent commands, ~78 of your skills grouped into eleven categories, and skill bundles when you install one**, behind faceted tabs. Every allowlisted command carries a measurement taken against the running agent, and every refusal carries a reason — because the alternative, discovered repeatedly while building this, is a command that reports success and changes nothing.
- **Standing Goals**: `/goal <text>` sets an objective the agent works toward across turns, with a judge deciding after each one whether to continue. Continuations render as **distinct messages** rather than folding into the previous reply, and a progress card shows the verdict and turn count. `/subgoal` adds criteria. This was the one capability the web UI lacked that the CLI and messaging surfaces both had.
- **A Toolsets Screen**: Toolsets govern what the agent may do, and nothing in the app showed which existed or which the gateway was suppressing. Read-only, deliberately: `tools.configure` hardcodes its platform to `"cli"` while chats run under `api_server`, so a toggle would report success and change nothing you could see. A test asserts the screen renders no toggle.
- **Session Branching**: `forkSession()` had existed for months, referenced only by tests. Branch from the sidebar to explore a different path; the confirm says the original session is closed, because "Branch" otherwise reads as a harmless copy.
- **A Per-Chat Approval Bypass**: `/yolo` never worked here — the state is an in-process set with no IPC, so the command toggled a subprocess while approvals were enforced elsewhere. This calls the gateway endpoint that enforces them. Four honest states including **unknown**, because reporting "off" for a state we could not read is the failure it replaces.
- **`pnpm dev:health`**: This app serves HTTPS under `pnpm dev` and HTTP under `pnpm start`, and an `http://` probe against the HTTPS server returns an instant empty reply — indistinguishable from a wedged process. The probe tries both, tells "wrong scheme" apart from "nothing listening", allows 90s for a cold SSR compile, and warns when Vite has silently auto-incremented onto a second port.

### Fixed

- **The Reasoning Level Was Sent As Your System Prompt**: `body.thinking` carries the effort *label*, and three consumers treated it as content. The thinking pane rendered the literal word "low" while the model's actual reasoning was accumulated and discarded; the final message persisted the label as its reasoning block; and worst, the enhanced path sent it as `system_message`, which the gateway applies verbatim — so **every reasoning-enabled send prepended `"low"` as a system prompt**.
- **The Reasoning Picker Did Nothing**: The level never reached the gateway. It is now forwarded per request. Two further defects surfaced: the field was dropped entirely when set to **None**, so "None" silently meant "use whatever the config says"; and the rehydration allowlist covered three of the five levels the picker offers, so a stored `medium` or `high` came back as `low` after reload, making both unreachable.
- **Forking Returned 400 On Every Real Call**: Two independent faults, invisible to tests that stub `fetch` and assert only on URLs. It sent no request body, and the gateway parses one unconditionally. Its unscoped path also took a shortcut to a dashboard route that does not exist.
- **The Setup Checklist Reported Seven Configured Steps As Outstanding**: It asked "did someone walk the wizard?" rather than "is this configured?" — every signal but one was hardcoded, and the fallback read an array that installs settling via auto-detect leave permanently empty. "Connect a provider" was the tell: the one item with a live signal, and the one item reporting correctly. The theme step never read the theme at all, so being on one was indistinguishable from never choosing one.
- **The Picker Offered Commands The Server Would Refuse**: Four times, in four shapes. `/tools` held its menu open to complete a subcommand that was then rejected; `/compress` nearly shipped the same way; and `/goal draft` — advertised, unhandled — would have set your goal to the literal text "draft" and started an agent loop working on it. Advertised forms are now derived from the same policy that accepts them, with a guard that fails the build on the fifth instance.
- **Five Commands Were Neither Advertised Nor Runnable**: A command both allowlisted and locally handled is dropped from the picker as "shadowed" *and* answered locally. `/status` hit this, was fixed by hand, and the fix was not generalised — so adding four commands recreated it four times. Now guarded in both directions.
- **A Fixable Message Arrived As A Crash**: `/subgoal remove abc` answers `must be an integer`, which reached the user as HTTP 502 through a generic catch. The agent has no error-code table — a bare constructor with ~265 call sites — so this is a range rule rather than a lookup that would drift: your mistakes become 4xx with the agent's own words, real gateway failures stay 5xx.
- **Command Output Was Unbounded**: `/debug local` returns **1.15 MB**, and grows with the log tail. Capped at 64 KiB, in-band, stating the real size rather than silently truncating.

### Removed

- **A Usage Meter That Would Have Shown Zero**: Written months ago, never mounted, and broken: both meters fetched session status without a session key, and that endpoint answers a bare request with the "new session" payload. It would have rendered a confident zero regardless of spend. Removed with its details dialog, its ⌘K entry and the `/api/provider-usage` route it was the only consumer of — 39 KB of provider fetchers that had never run in production.
- **Scaffolding For Features That Do Not Exist**: `steerAgent()` posted to a route that was never built, from a component with no import sites. Two `data-tour` markers pointed at a guided tour deleted in an earlier refactor.

### Changed

- **`/stop` Is Now `/interrupt`**: The agent's `/stop` kills background processes and does *not* stop the turn — the opposite meaning under the same word. `/stop` keeps working as a transitional alias.
- **Commands Refuse To Run Against An Old Agent**: Below hermes-agent 0.19.16, `/compress --preview` really compresses and reads hit the wrong profile. The floor is enforced independently of the picker, and skills are checked *before* it — an older agent loses fifteen registry commands and keeps its ~78 skills.

### Note

Ten defects found in the agent while building this were filed upstream; nine shipped as hermes-agent 0.19.12 through 0.19.16, including one where `/compress --preview` performed a real, irreversible compression. `docs/plans/hermes-slash-commands-in-switchui.md` records the rule that survived the work — does the answer come from a surface both processes share, does the effect land where turns run, does it carry information a screen does not — with the measurement behind every verdict and an appendix of what we believed and why it was wrong.

## [2.5.36] — 2026-08-11

### Fixed

- **Settings Never Saved, And Said They Did**: The page sent `PATCH /api/config`. The gateway implements `GET` and `PUT` for that route and nothing else, so every write returned 405. The saver only surfaced errors whose message contained `400`, so a 405 was swallowed silently, and the store then committed the patch and cleared its dirty set unconditionally — the bar read "Saved" on a save that had reached nothing. Roughly forty settings across eleven sections were affected, including approval mode, allow-private-URLs, the Tirith scanner, auto-accept shell hooks and the command allowlist: a user tightening their security posture got a green confirmation and an unchanged gateway. The verb is now `PUT`, failures are surfaced, and the store commits only the keys the gateway confirms.
- **The Settings Dialog Wrote Behind The Running Gateway**: Its Agent, Smart Routing, Voice and Display tabs wrote `~/.hermes/config.yaml` directly to disk through this app's own route, then told you to restart the gateway. That is a second, divergent write path to the file the Settings screen owns — and for `agent.max_turns`, `gateway_timeout`, `tool_use_enforcement` and the memory switches, a literal duplicate of keys the route screen already declares, so the two surfaces could race. They now write through the same live transport, which takes effect without a restart.
- **Edits Vanished When You Changed Section**: Seven sections called the store's `load()` in a mount effect. `load()` is a reset — it rebuilds the draft from the last server snapshot and clears every dirty key — so editing Safety and then opening Appearance discarded the Safety edit, and the save bar reported nothing pending. Those same calls also latched a `loaded` flag that permanently blocked the real server seed, so if a seeding section mounted before the config query resolved, every control rendered a hardcoded fallback and a save would have pushed those invented defaults.
- **The Sidebar's Unsaved Marker Could Never Appear**: It tested section ids against a set of setting *keys* — two namespaces that never intersect, so the branch was unreachable. Sections now declare the keys they own, and the marker resolves through that.
- **Import Was A No-Op**: It called `load()` with the imported values first, which made them equal to the committed snapshot, so the loop that followed removed every key from the dirty set instead of adding it. Nothing was ever saved; the success toast still counted the keys.
- **Free Text Where The Gateway Expects An Enum**: `agent.service_tier` is published by the gateway as a four-value select. It rendered as a text input, so a typo saved without complaint, the agent fell back to its default, and nothing indicated the setting had not applied. The log-level picker was separately missing `ERROR`, which the gateway has always accepted.
- **Destructive Buttons Were Unstyled On A Cold Load**: `btn-danger`, `btn-primary` and the confirmation modal's classes are defined only in the Jobs, Profiles and Tasks stylesheets. Landing on `/settings` directly — rather than after visiting one of those pages — left "Delete workspace", "Restart gateway" and "Revoke" looking like ordinary buttons, and the delete confirmation as an unpositioned div. The confirmation is now a real dialog with an Escape handler, a focus trap and an accessible name, and the missing classes ship with the settings sheet.
- **Status Colours Were Invisible In Every Theme**: Eight `--m-*` tokens were referenced that no theme declares — `--m-accent` alone in sixteen places — so they resolved to nothing, including in Matrix. A further 193 token references carried no fallback, and `--m-*` exists only under `[data-theme='matrix']`, so section content was unthemed on the other nine themes while its frame themed correctly.
- **No Control Had A Name**: `SettingRow` rendered its label as a `div`, so roughly 150 inputs, selects, toggles and sliders announced as bare "edit text" or "switch". The stylesheet also had no `:focus-visible` rule at all, and suppressed the default outline in three places, leaving keyboard users unable to see focus.

### Added

- **Every Setting The Gateway Supports Is Reachable**: The page hand-maintained 48 of the 555 configuration fields the gateway publishes at `GET /api/config/schema` — an endpoint three client functions already existed for and none had ever called. Curated sections now bind to it, so option lists come from the gateway instead of drifting from it, and a new **All settings** browser lists the full 555, searchable and grouped by the schema's own categories, with each dotted key path shown. Raw YAML remains as a third tier, because 58 keys in a real `config.yaml` have no schema field at all.
- **Sections Are Linkable**: The active section lived in `localStorage`, so `/settings` could not address one and the back button did not move between them. It is now `?section=<id>`. Deliberately a search param rather than a path segment: `/settings/providers` is a different screen, and a `$section` route would have shadowed it.
- **Search That Finds Settings**: The sidebar filter matched section titles — twenty-eight strings — so "docker", "tirith", "retention" and "port", all real editable settings, matched nothing. It now indexes setting names, descriptions and key paths.
- **Collapsible Sidebar Groups**: Twenty-eight sections across eleven groups did not fit a laptop rail. Groups collapse, and start collapsed. The group you navigate into opens automatically, a collapsed group still reports unsaved changes, and one holding the open section names it, so collapsing where you are does not lose your place.

### Removed

- **Twenty-Five Controls That Persisted To Nothing**: Six sections wrote `hermes.*` keys to `localStorage` that no code outside the settings folder ever read. The Matrix-rain toggle never reached the rain canvas, which mounts unconditionally; the six "rebindable" shortcuts had no handler; hardware acceleration has no meaning in a browser page; density had no implementation. Workspace, Account, Notifications and Shortcuts were entirely dead and are now short read-only cards stating something true — Shortcuts documents the bindings that genuinely exist. The theme picker survives, because it alone worked.
- **A Dead Settings Sidebar**: 128 lines with no importers.

### Changed

- **One Store Name, One Meaning**: `src/hooks/use-settings.ts` exported a store also called `useSettingsStore`, unrelated to the gateway settings store of the same name, which made every search for it a coin flip. It is now `useStudioSettingsStore`; its `claude-settings` storage key is unchanged.
- **The Save Bar Tells The Truth**: It spoke for nineteen sections it does not control. Sections declare whether the bar saves them, saves them partly, or not at all, and cards that write immediately are labelled "Saves immediately".
- **The Plugin Settings Mirror Moved To The Store That Owns It**: It fired only on a gateway-config save, so a preference changed from the chat dialog was never reported, and five of its six mapped keys were among the dead controls above. It now follows the browser-preference store and reports from either surface.

### Note

Documentation was rewritten against the shipped page. `docs/settings/preferences.md` described twenty-two sections in placeholder prose and missed six that ship; `workflows-backend-toggle.md` documented a native workflow engine, a backend toggle, a storage key and a URL param, none of which exist — the engine factory has only ever returned the plugin client.

## [2.5.35] — 2026-08-11

### Added

- **Global Profile Selector**: The sidebar has an app-wide profile picker, above `+ New Session` rather than replacing it — scope and act are different verbs, and starting a session should not require opening a menu. Unreachable profiles are disabled with the gateway's own reason, so a profile that cannot be served is refused before a message is composed rather than after it is sent. `+ New Session` now carries the resolved profile explicitly instead of inheriting whatever was sticky on the URL.
- **Setup Checks Whether Your Profiles Can Actually Be Reached**: With several profiles on disk and a gateway that is not multiplexed, only the launch profile works — and you previously discovered that at send time, from a refusal, after writing a message. Onboarding now compares the on-disk roster against the profiles the gateway is really serving and says so up front, with the fix inline. It diffs against the served list rather than trusting the mode flag, because a profile enabling a port-binding platform is skipped at startup and silently absent. A single-profile install is never nagged, and a topology that cannot be determined reports uncertainty instead of a diagnosis.

### Fixed

- **Empty Model Dropdown**: `/api/models?profile=default` mapped the name straight to `~/.hermes/profiles/default`, which does not exist — the synthetic default lives at the Hermes root, and that special case was never mirrored here. The config read returned null and the route answered `data: []` with HTTP 200 and `ok: true`, which is indistinguishable from "nothing configured", so nothing surfaced. Resolution now goes through the same helper the profiles API uses, which also brings a path-traversal guard the old join lacked.
- **Only `auto` In The Catalog**: The provider reader wanted a `custom_providers` array for model metadata, so a config declaring `model.base_url` directly produced a single placeholder entry. Those endpoints are now enumerated directly — cached per base URL, short timeout, and a fail-soft fallback to the last good list so a flaky endpoint degrades the catalog instead of emptying it. The API key only ever reaches the Authorization header.
- **The Sidebar Profile Picker Did Not Change Where Messages Went**: It wrote a store whose only consumer in the entire app was the sessions list. The thing that actually routed traffic was the `?profile=` URL param, and a third notion in `active_profile` needed a gateway restart — three unconnected answers to "which profile am I in", so you could browse one profile's sessions while the composer sent to another. There is now one resolver, `url ?? device ?? null`, and the sidebar is its writer. The URL still outranks it, and the code enforces that: while a tab is URL-pinned the picker shows the pin and has no path to the writer, because session ids are not unique across profiles and a conversation that lost its profile mid-thread would keep streaming, return 200, and write the rest of itself into another profile's database.
- **The Composer Chip Always Said DEFAULT**: It read the URL only and fell back to a hardcoded literal, so it could never reflect a sidebar selection. It now shows the resolved profile, and says `Unscoped` explicitly when there is none — `default` is itself a real, selectable profile, and conflating the two emits wrong `/p/default/` prefixes.
- **Approvals Arrived Late, Or Not At All**: The timeout was never the problem; the countdown already came from the gateway's own deadline. Delivery was. There was one live path, and losing that stream lost the approval, while the recovery query only refetched on focus or reconnect — so a miss in a tab that stayed focused never recovered. It polls now, and the recovery hook moved out of the chat header, which the side panel does not render, so that surface had no recovery whatsoever.
- **Approval Cards That Were Present But Invisible**: A card rendered either via the thinking bubble or attached to the last assistant message, and that second surface is suppressed when tool display is set to "hidden" — a persisted preference. So a user who once changed that setting got a bell count and no card. An approval is a security prompt, not tool chrome; it now renders beside the composer regardless of tool display, anchor message, or an active search.
- **Unanswered Approvals Were Deleted By Stream Errors**: Three paths dropped them, including the 600-second stream timeout. The run stays blocked and the decision is still needed, so approvals now survive all three, and the pending-approvals poll reconciles them away only on a response that genuinely no longer lists them.
- **Model Selection Wrote Global Gateway Config**: `switchModel` took a session key it never used and issued a config write that retargeted every consumer of the gateway — against an endpoint that does not exist on it, so it had been silently failing. Selection is per-session now, and the local-model override that was never keyed by session at all, and therefore leaked a choice made in one chat into every other, is gone.
- **`/model` Did Nothing**: Bare `/model` dispatched an event with no listeners; `/model gpt-4` failed an exact-string check and was sent verbatim as chat text to a transport with no slash interpreter, which is why it only ever worked against the agent CLI. It is tokenized now.
- **Cross-Profile Data In The Sidebar And Search**: Nav badges, the skills browser, the command palette and the kanban queries were not keyed by profile, so switching would have shown the previous profile's counts and sessions. Keys are scoped through a helper that returns nothing when unscoped, so existing caches stay byte-identical rather than being invalidated wholesale on upgrade.
- **A Leaked Timer Per Stream**: Two heartbeat intervals shared one variable, so only the second was ever cleared, and the stream's cancel path — which fires on every navigate-away — cleared neither.

### Changed

- **Per-Session Model Switching, Client Side**: Aligned to the gateway's new contract. The session key is derived one way for every transport, because the override is stored under it and a client that sends it inconsistently writes under one key and reads under another. A rejected model can arrive two ways — a 400 before the stream opens, or an HTTP 200 whose assistant message *is* the rejection, which is what a permissive aggregator returns — and both now roll the selection back instead of leaving the session stuck on a model that cannot answer. A switch to an unused model can take seconds, so a send carrying a changed model shows a pending state. The effective model is read back from the run rather than assumed, so a server-side fallback is visible.
- **The Gateway's `/v1/models` Is Not A Catalog**: It advertises the server's own identity plus route aliases. The settings dialog was synthesizing a model list from it, and the portable path could send that identity as an explicit model, which the gateway treats as expressing no preference. Both are gone; the catalog remains `/api/models`.

### Note

Switching models requires gateway support for a per-request model on the sessions transport. Everything on this side is in place for when that lands.

## [2.5.34] — 2026-08-09

### Added

- **Rebuilt First-Run Setup**: The first thing a new install shows is now a branching wizard rather than a product tour. Quick start is welcome → provider → connect → review → verify → finish; full setup adds a system check, an agent profile, memory, the core plugins, and the theme picker. The provider step lists all 24 catalog entries grouped as detected, free, popular and all; the review step prints the literal `config.yaml` and `.env` text before anything is written; verification polls the gateway afterwards and offers an inline restart.
- **Agent Profile Step**: The four seeded built-ins — Hermes Switch, Neo, Trinity, Morpheus — were invisible unless you went looking for the Agents screen. The step activates a profile rather than creating one; the nine-step create wizard on the Agents screen is still the place to build a new one. The Default row (the root `config.yaml`, which is what runs when no profile is pinned) is shown rather than filtered out, so the list can never render with nothing marked active.
- **Memory Step**: Recommends Matrix Memory, on the grounds that it is the only provider that is bundled, has its dependencies installed, and needs no key, no account and no external service — one SQLite file under `~/.hermes` running the Mnemosyne engine. Despite the name it has nothing to do with the Matrix chat protocol: no homeserver, no federation, no network call. Readiness for every provider is read from the gateway rather than assumed.
- **Core Plugins Step**: Two labelled groups — plugins authored by Interstellar (Workflow Engine, A2A Fleet, Personas, MCP Lazy Loading), and the upstream ones that gate a screen this workspace ships (Kanban, Projects). Bundled plugins get a working toggle; the rest show the exact CLI command, because enabling them is outside this process's reach. The restart requirement is stated rather than implied.
- **Every Step Leads With What Is Already Configured**: Reopening the wizard on a working install used to show each step as though nothing existed. The active provider is now pilled and hoisted to the top of its group rather than being card nine of twenty-four, the applied theme is marked distinctly from the one you just clicked, and the connect step names the environment variable already holding your key.
- **Setup Survives Being Interrupted**: Progress is drafted to local storage as you go — never the API key, never an OAuth code — so closing the tab mid-setup resumes where you left off.
- **Skipped Steps Stay Reachable**: Anything you skip appears on a checklist reachable from a count badge on the sidebar, the command palette, and a dismissible dashboard card whose items deep-link to the step they belong to. Skipping something is no longer the same as never being told it existed.

### Fixed

- **Nous OAuth Corrupted The Provider Config**: Completing the flow wrote a bare `providers: { nous: { type: openai } }` entry. The gateway resolves providers two different ways with opposite precedence — inference kept working, so the damage was invisible, but the picker and CLI take user config first and do no validation, so that stub replaced the real OAuth definition. `--provider nous` then failed outright with no base URL, and the model picker grew an unselectable empty row.
- **Wizard Vanished Mid-Setup**: On an install whose backend was already reachable, the connection probe could resolve while the user was part-way through and close the wizard under them, discarding whatever had been typed. The probe now only redirects a flow the user has not touched.
- **Skipping Setup Counted As Finishing It**: "I'll set this up later" wrote the same completion flag as finishing the wizard, so the user was never prompted again and landed in a workspace with no provider. It records a dismissal, which stays re-promptable.
- **Verify Did Nothing On A Reopened Wizard**: The button keyed off the provider you had picked in this run, which on a relaunch is none — you opened the wizard to look at what was already there. It now verifies the provider actually running.
- **Step Rail Clipped The Whole Wizard**: The rail reserved space for every label on one row, which sized the shell wider than the window containing it — so the header, body and footer were all cut off at the same edge. It wraps now, and the window is wider.
- **The Setup Badge Was Stuck**: Completion recorded which steps were skipped but never which were done, so a user who finished everything still saw an outstanding count with no way to clear it.
- **Kanban Reported As Not Installed**: It ships without a plugin manifest, so it never appears in the plugin hub, and the step read that absence as absence-of-installation while the Tasks screen was plainly working. Anything the hub cannot see now reports what the gateway's own capability probe says.
- **Memory Settings Could Not Select The Active Provider**: The catalog described six of the nine providers that ship on disk, so a config running any of the other three could not be represented, let alone changed.
- **Delegations Returned 500 On Every Poll**: `GET /api/sessions/:key/delegations?profile=default` threw an undefined-reference error, retried on a 12-second poll, filling the console during an ordinary chat session.
- **Illegible Status Colours In Nine Of Ten Themes**: `--m-danger`, `--m-warning` and `--m-info` are declared only under the Matrix theme, so every other theme fell through to a hard-coded Matrix hex — near-invisible on the five light ones. Around 860 fallbacks across eighteen stylesheets now resolve to the active theme's own colour.

### Changed

- **Reopening The Wizard Is A Settings Surface**: "Setup Wizard" in the sidebar opens directly on the stepped view with every step clickable, rather than a summary you had to click past. Review appears only once you have actually changed something.
- **Removed `react-joyride`**: The guided product tour it powered is gone, replaced by the wizard above. It had been inert for some time — it waited on a flag nothing wrote, and seven of its nine anchors did not exist.
- **Reads In All Ten Themes**: The flow is two scoped stylesheets with no hard-coded colours, checked by contract tests that now also verify a fallback names a token some theme actually declares — roughly 110 pointed at tokens that existed nowhere. The wizard is usable at 320px, every status is stated in text and not only in colour, and all animation stops under `prefers-reduced-motion`.

## [2.5.33] — 2026-08-09

### Added

- **Providers Inventory Screen**: Rebuilt `/settings/providers` in the house pattern used by `/skills` and `/mcp` — collapsible filter rail (status / origin / auth / models with live counts), card grid and table views, stats header, and a right-anchored detail drawer with Overview, Models, Credentials and Config tabs. Catalog providers not yet in `config.yaml` render as `available` cards, so adding one is a click from the provider you want.
- **Working Add Provider Wizard**: Choose → Connect → Review & Save → Verify. The review step shows the literal YAML fragment before anything is written, and verification polls `/api/models` afterwards, offering an inline gateway restart when the provider is saved but not yet visible.
- **Relaunchable Setup Wizard**: The first-run onboarding wizard is now reachable from the sidebar and the command palette. Relaunches start locked and will not modify an existing provider configuration until changes are explicitly unlocked.
- **Provider Removal**: `DELETE /api/claude-config` removes a provider's `providers` entry, its `custom_providers` row and matching `model_aliases`, reassigns the active provider to a survivor, and can optionally drop its env key — refusing when another provider still references it.

### Fixed

- **`.env` Comment Destruction**: `writeEnv()` serialised a parsed key map back out, erasing every comment and blank line in `~/.hermes/.env` the first time a user saved an API key — a documented 500-line file collapsed to 13. Key values were preserved, the file was not. Replaced with in-place line editing.
- **Add & Delete Provider Never Worked**: The wizard POSTed API keys to `/api/config-patch`, a route that does not exist, in an `auth.profiles.*` shape nothing reads; delete POSTed to a method with no handler and failed every time.
- **Inline Provider Configs Reported As Unconfigured**: Providers defined inside the `model:` block with the key stored in `config.yaml` (rather than in a `providers:` map with `key_env`) were shown as having no credential. Edits to them now patch that block in place instead of adding a second definition the gateway ignores.
- **OAuth Providers Falsely Reported Configured**: `GET /api/claude-config` treated any provider with no env keys as configured and sourced from `env`.
- **`custom_providers` Key Mismatch**: `models.ts` indexes those entries by `id` while `isProviderConfigured()` matched only on `name`, so an entry written by one reader was invisible to the other.
- **Unreadable Provider Page In Dark Themes**: Hard-coded `bg-white` surfaces rendered light-green text on white across the Models, AI & Agents, Session and Memory tabs. The screen now has a scoped Matrix stylesheet with no hard-coded light surfaces, verified across four themes.

### Changed

- **Single Provider Registry**: Six divergent provider lists are consolidated into `PROVIDER_CATALOG`, which now carries `envKey`, `baseUrl` and `origin` and grows from 18 to 24 entries. The server config route derives its list from it, lifting the 12-id ceiling on its auth-status payload. A contract test keeps the remaining display-only lists anchored to it.
- **Removed Nine Non-Persisting Settings**: The Models, AI & Agents, Session and Memory tabs wrote to `agents.defaults.*` through the phantom `/api/config-patch` route — a namespace present in neither `config.yaml` nor the gateway. Their real counterparts already exist in the Settings sections.
- **Shared Credential Row**: Reveal-with-auto-hide, edit and delete behaviour is extracted into `useEnvVarRow`, shared by the API Keys section and the provider drawer.

## [2.5.32] — 2026-08-06

### Fixed

- **Agents Toggle Button Layout & Overlap**: Fixed `Show agents` toggle button positioning in `chat-screen.tsx` by offsetting it dynamically above `--chat-composer-height`, preventing button overlap with composer action controls and input text on smaller desktop resolutions.

## [2.5.31] — 2026-08-06

### Fixed

- **Remote & Active Profile Probing**: Fixed `probeMode()` in `profile-scope.ts` to fall back to `hermes_home` when resolving the active profile name, preventing false-positive `ProfileScopeUnavailableError` when accessing SwitchUI remotely via Tailscale or LAN while `gateways` array is empty.

## [2.5.30] — 2026-08-04

### Fixed

- **Multi-Profile Multiplexing Recognition**: Enhanced `probeMode()` in `profile-scope.ts` to inspect served profiles and profile rosters across all gateways, preventing single-profile false positives and 409 Conflict errors when targeting secondary profiles (`neo`, `morpheus`, `trinity`).
- **Profile-Aware Delegations DB Resolution**: Fixed delegation DB resolution to inspect target profile home paths dynamically instead of hardcoding default profile paths.
- **Secondary Gateway Port-Binding Isolation**: Disabled redundant secondary `a2a_fleet` port bindings on secondary profiles so multiplexed gateways load and serve all host profiles cleanly without startup skips.

## [2.5.29] — 2026-08-04

### Changed

- Chat profiles are selected only when creating a session; after the first run, the session remains visibly bound to its original profile.
- Desktop and mobile session navigation preserve explicit profile scope, including direct session reads and history queries.
- The gateway restart banner now shows the supported `hermes gateway restart` command.

### Fixed

- Changing the profile for a new chat no longer changes the gateway-wide active profile or incorrectly requests a gateway restart.
- Existing sessions can no longer be retargeted to another profile from the composer.
- Obsolete restart warnings created by the former Chat profile activation flow are cleared from persisted state.

## [2.5.28] — 2026-08-03

### Added

- **Profile-scoped Projects** — select a Hermes profile from Projects and carry that explicit scope through list, detail, folder, activity, create, edit, archive, restore, delete, and active-project requests.
- **Complete Kanban lifecycle** — Tasks now displays and edits Hermes-supported `scheduled` and `review` statuses instead of silently dropping those cards.
- **Assignee clarity** — Tasks separates configured profiles, historical assignees, and unassigned work, with visible and total counts for the current scope.

### Changed

- The persistent terminal now reserves layout space for non-chat workspaces, so Tasks, Boards, Projects, Files, and Settings resize instead of rendering behind it.
- Task counts and summary statistics come from the same current board and tenant scope as the displayed cards.
- Boards explicitly identifies Kanban data as global and shared across profiles.

### Fixed

- Tasks no longer mixes backend-global assignee totals with visibility-filtered card counts.
- Historical assignees such as completed producer identities retain attribution without being presented as configured profiles.
- Assignee selection remains synchronized with `/tasks?assignee=...`, including the explicit Unassigned filter.

## [2.5.27] — 2026-08-03

### Added

- **Profile-safe chat sessions** — browse sessions by Hermes profile while client caches, active runs, queued messages, history, clarification, delegation, rename, delete, and send operations preserve the selected profile identity.
- **Terminal workspace reliability** — real PTY resizing, ordered input delivery, lossless output buffering, bounded reconnects, split panes with draggable sizing, project working-directory choices, accessible tabs, and hardened mobile input.

### Changed

- Secondary terminal panes now select a working directory using the same Hermes home, user home, and project list as new sessions; matching terminals are reused and missing ones are created automatically.
- Portable chat sends support multimodal attachments and fall back safely between Responses and Chat Completions providers.
- Gateway connection changes and reprobes invalidate cached profile topology, and backup endpoints consistently enforce the authenticated/local access boundary.
- Terminal rendering pauses hidden decorative work and avoids duplicate workspace ownership.

### Fixed

- Profile-scoped requests fail closed when the running gateway cannot prove that it serves the requested profile, preventing cross-profile session collisions or writes.
- Session search, active-run polling, streaming recovery, local queues, and route transitions retain their correct profile scope.
- Terminal resize now reaches the live PTY, normal shell exits stay exited, reconnects clean up stale readers, and high-volume output is no longer truncated.
- Removed the terminal Debug Analyzer panel and the redundant background-effects toggle.

## [2.5.26] — 2026-08-01

### Added

- **Update Center** — review SwitchUI and Hermes Agent updates from Settings or the in-app update prompt, inspect version and blocking-file details, and confirm before applying.
- **Desktop update controls** — Electron builds can download an update and install it on restart from inside the app.
- **Searchable older chat sessions** — sidebar search reaches sessions outside the initial recent page without loading the full collection.

### Changed

- **Faster chat navigation at scale.** Chat initially loads the 200 most recent sessions, fetches older deep-linked sessions directly, and updates active sidebar rows without reloading every session.
- Session refreshes are less frequent, idle navigation avoids a redundant history request, and live-tool recovery reads only the newest 100 messages.
- Update checks use verified fast-forward targets; Hermes Agent updates use its strict updater path so dependency refresh and restart behavior are preserved.
- Copied file paths now use the real workspace root instead of a generic `workspace/` prefix.

### Fixed

- Session navigation shows immediate accessible **Opening…** feedback while the target chat loads.
- Image attachments preserve their MIME type through the send path.
- Delegation views show a child agent's final response even when it recorded no tool activity.
- Update prompts no longer interrupt users with native Electron dialogs, and local development check-only states no longer create non-actionable global prompts.
- The application CSP permits supported `data:` connection flows.

## [2.5.25] — 2026-07-24

### Added

- **Files v2 sidebar in Chat** — the chat file explorer now shares the Files workspace styling, quick jump, search, and file actions.
- **SQLite binary handling** — `.db`, `.sqlite`, and `.sqlite3` files are safely identified as binary and offered for download instead of being decoded as text.

### Changed

- Quick Jump is centered and viewport-bounded so its results remain visible instead of rendering at the bottom of the page.
- Folder listings use serial numbers and show folder item counts beside names.
- Removed the chat token-rate indicator from the session metadata bar.

## [2.5.24] — 2026-07-24

### Added

- **Finder-style Files workspace** — two-pane browsing, folder navigation, search, selection, context actions, and responsive mobile access replace the previous single-purpose file view.
- **Plugins screen** — browse installed plugins, navigate to them from the app shell and command palette, and manage registered MCP-plugin integration from Settings.
- **Unified chat navigation** — session filtering, focus mode, slash-command support, cleaner source chips, and accurate delegation/session indicators.
- **Project session selection** — chat sessions can be associated with the active project.

### Changed

- File documentation and design assets now describe the current Files v2 experience.
- Removed the retired workspace-daemon development proxy and auto-spawn plumbing.

### Fixed

- **Web chat delivery in development.** The retired daemon middleware now forwards every non-healthcheck request, so `POST /api/send-stream` reaches Hermes Agent again.

## [2.5.23] — 2026-07-23

### Added

- **Dedicated chat-history views** for to-dos, MCP calls, skills, and file activity. Each view has its own count and keeps unrelated calls out of the way.
- **Agents drawer** — a robot-icon launcher beside the composer opens the session's sub-agent activity and shows the current agent count.

### Changed

- Tool, MCP, skill, and to-do call details are now human-readable: meaningful labels and fields are shown first, with raw input/output available on demand.
- The chat no longer reserves a permanent Agent View column; the on-demand Agents drawer preserves more room for the conversation.

### Fixed

- Agent counts combine persisted child sessions with live delegation events without double-counting, and remain correct before a child session is persisted.
- Base UI preview cards no longer crash when their preview ref is unavailable.

## [2.5.21] — 2026-07-21

### Added

- **Guided Self-Improve scenarios** — create training or held-out scenarios with typed checks, inspect full prompts and readable check labels, and delete scenarios through a confirmation dialog.
- **Analysis-first status summary** — independently reports plugin, profile, and loop state, then recommends the next action from bootstrap through collection, proposal, approval, and observation.
- **Actionable next steps** — collect metrics, jump to the relevant screen section, or copy the profile-specific bootstrap command directly from the summary.
- **Proposal confirmation** — shows the target, models, and estimated cost before starting an experiment.

### Changed

- The Self-Improve screen now leads with current state and the next required action, with clearer metric windows, experiment state, responsive layout, and accessible interactions.
- Updated `react-grab` from 0.1.44 to 0.1.48.

## [2.5.20] — 2026-07-20

### Added

- **Profile configuration panel** on the Self-Improve screen — shows the selected profile's paused state with Pause/Resume controls, the target file the ratchet edits (`target_relpath` / `target_profile_root`, sourced from the newest experiment), and a copy-paste `hermes karpathy bootstrap --profile <p>` hint for un-bootstrapped profiles.
- **"Takes effect" badge** on experiment cards — renders "Takes effect on next session" or "Live now" from the plugin's `live_takes_effect_at_next_session` field.

### Changed

- `Experiment` type now carries `live_takes_effect_at_next_session`, `target_relpath`, and `target_profile_root` (all already returned by the plugin's experiments API).

### Fixed

- **Apply failures are now distinguishable.** A failed patch (HTTP 422 from the plugin) shows "Patch failed — experiment not applied" instead of a generic error — the browser fetch wrapper now attaches the HTTP status to thrown errors so callers can branch on it.

## [2.5.19] — 2026-07-19

### Added

- **Profile-scoped Self-Improve metrics.** The Self-Improve screen now collects and reports metrics per agent profile instead of one global `"(unknown)"` bucket. Metric collection sends the selected profile, every query is gated on a chosen profile, and a sensible default is picked as profiles load. Adds a `GET /api/self-improve/profiles/{profile}` status route (paused/running) and a `ProfileStatus` type. Requires the matching per-profile backend in the `karpathy-self-improve` plugin (Interstellar-code/hermes-agent#174).

### Changed

- `collect` now requires a profile — the metrics POST route rejects missing/blank profiles and invalid JSON with `400`.

### Fixed

- Negative cost deltas now format as currency (e.g. `-$0.25`) instead of a bare minus.
- `Escape` closes the scenario create dialog; focus-visible outlines added to Self-Improve controls; the screen lays out correctly under 640px.

## [2.5.18] — 2026-07-19

### Fixed

- The Agent Memory pane now shows the active per-profile `SOUL.md`, `MEMORY.md`, and `USER.md` as tabs. It reads `SOUL.md` from the profile root and the two built-in memory stores from the canonical `memories/` directory, instead of showing the stale profile-root `USER.md` placeholder.
- Built-in profile bootstrap now creates `memories/MEMORY.md` and `memories/USER.md` where Hermes Agent actually loads them.

## [2.5.17] — 2026-07-19

Memory screen overhaul: a real graph of your memory, and a chat that actually talks to it (#342).

### Added

- **Memory Map** — a D3 force-directed graph replaces the old Wiki Graph tab. It renders the full mnemosyne knowledge graph on a canvas (~7k nodes / ~13k edges): `gist` / `working` / `fact` / `entity` / `episodic` / `wiki` nodes tied together by `ctx` / `references` / `mentions` / `about` / `relates` / `summarizes` edges — so memories actually interconnect through shared entities instead of floating as star-dust. Backed by a read-only BFF at `/api/memory/graph` (edge dedup, per-kind labels truncated to 60 chars; raw memory text never leaves the server).
- **Filter panel** on the Map — node-kind toggles, edge-type toggles, a "hide isolated nodes" switch, and a min-connections slider (raise it to peel the long tail and reveal just the hubs). Default is everything visible.
- **Memory Chat** — the Chat tab is now a strictly memory-grounded assistant. It retrieves from your memory files (`/api/memory/search`) **and** matrix-memory (`/api/memory/mnemosyne-search`), then answers **only** from that context via a non-agentic completion (`/api/memory/chat`). If nothing relevant is found it replies "I don't have that in my memory." — no general-knowledge guessing.

### Changed

- The **Map** and **Browse** tabs now appear only when matrix-memory is configured and activated (its mnemosyne DB exists and holds memories); they are hidden otherwise, and a persisted-active gated tab falls back to Agent Memory.
- Memory screen store bumped to v2 (persisted `graph` tab migrates to `map`; unknown values → `memory`).

### Fixed

- The memory Chat previously did nothing: it mis-parsed the streaming response (expected OpenAI `choices[]`, but the server emits `event: chunk` / `{text}`) and was grounded in the wiki rather than memory. It now parses the stream correctly and grounds strictly in memory.

### Removed

- Legacy Wiki Graph tab (`graph-tab.tsx`), the `/api/knowledge/graph` route, and `buildKnowledgeGraph()` / the `KnowledgeGraph` type — the wiki parser, CRUD, providers and resolvers are retained.

## [2.5.16] — 2026-07-19

### Fixed

- **Build no longer hangs.** The SPA prerender (`maskPath: /settings`) runs server code at build time; two module-level `setInterval` maintenance timers (auth-token prune, rate-limit cleanup) plus the gateway plugin-sync heartbeat kept the event loop alive, so `pnpm build` never exited — hanging CI "Build & Lint" and the Docker image build for hours. Timers are now `.unref()`'d, and the gateway probe + plugin-sync boot are skipped during the prerender (`HERMES_SKIP_GATEWAY_BOOT`). Runtime and dev are unaffected.

## [2.5.15] — 2026-07-19

Projects CRUD now uses in-app modals instead of native browser dialogs (follow-up to the v2.5.14 CRUD).

### Changed

- **Create** project: `ProjectCreateWizard` modal with a live board dropdown, replacing `window.prompt`.
- **Edit** project: 2-step stepper (Identity → Folders); the Folders step adds / removes / sets-primary against the live project, all in-app.
- **Delete / archive**: reusable in-app `ConfirmDialog` (danger variant for delete), replacing `window.confirm`.
- Drawer Folders tab: inline add-folder field (no prompt); the drawer collapses when a modal opens.

## [2.5.14] — 2026-07-19

Projects CRUD v3, consuming the Hermes Agent 0.18.3 dashboard Projects API.

### Added

- Create and edit projects from the Projects screen.
- Add, remove, and select primary project folders.
- Set the active project, archive, restore, and permanently delete archived projects.
- Profile-scoped Projects requests so each SwitchUI profile reads its own Hermes Projects database.
- Mutation error handling, busy-state guards, query invalidation, and two-step deletion confirmation.

### Testing

- `pnpm test`: 222 files, 1,897 tests passed, 2 skipped.
- Projects files pass scoped ESLint.
- Production client/server bundles and prerender completed; the local Vite/esbuild process retains a native service handle after output generation on this macOS toolchain.

## [2.5.13] — 2026-07-19

Projects page **v2** — the read-only Projects screen gains live task/activity data and an Activity tab, consuming the enriched `projects` plugin contract from hermes-agent v2.1 (Interstellar-code/hermes-agent#170).

### Added

- Project cards now show task counts ("X tasks · Y open"), the bound board's **name** (chip linking to the board), last-activity relative time, folder count, and an active pill driven by the API's `is_active` flag.
- New **Activity** tab in the project drawer: the project's top-10 recent kanban tasks (title · status · time), read-only, via `GET /api/plugins/projects/{id}/activity`.
- `Project` type extended with the v2.1 fields; `getProjectActivity` client + `useProjectActivity` hook + `hermes-projects/$id.activity` BFF proxy route.

### Fixed

- Drawer header active state now derives from `is_active` (was still using the client-side active check, so it could read "idle" next to an "active" pill).
- CI: `pnpm/action-setup` no longer fails with "Multiple versions of pnpm specified" — dropped the pinned workflow version in favour of `package.json#packageManager`.
- CI: `eslint` ignores the `website/**` Astro subproject (own toolchain); quoted a docs frontmatter description containing a colon so the site build stops throwing.

### Notes

- Projects UI remains **read-only**. Create / edit / archive / bind-board stay CLI-only.

## [2.5.12] — 2026-07-18

Follow-up to the v2.5.10 stuck-thinking-bubble fix: handle the case where the backend is fully unreachable.

### Fixed

- The run-liveness watchdog only reconciled when the liveness probe positively confirmed the run was gone. When the gateway is mid `/restart` the probe can't be reached at all, so the watchdog exhausted its retries and did nothing — the thinking bubble hung until the 120s TTL (repro: run `/restart`, watch the last run spin on "Taking longer than usual"). It now reconciles on exhausted retries too, surfacing the interrupted/resend affordance. If the run is actually still live, the recovery check clears the interrupted flag on its next poll, so a false positive self-heals.
- Added an 8s per-attempt timeout to the liveness probe so a hanging proxy can't wedge it in-flight and block every later tick.

## [2.5.11] — 2026-07-18

Chat and terminal console-error cleanup.

### Fixed

- Deduplicated tool-call pills in chat messages. A finalized message carries the same tool calls in both its content and an embedded `__streamToolCalls` copy (kept so pills survive after streaming state clears); rendering both produced React "duplicate key" warnings and double-rendered pills. The combined list is now deduped by key.
- Stopped the `POST /api/terminal-resize 404` console spam. The initial resize fired at terminal creation with the tab's possibly-stale `sessionId`, before the session was established server-side — 404ing on first mount and after a gateway restart re-issues sessionIds. The resize is now deferred until the session is confirmed live.

## [2.5.10] — 2026-07-18

Chat resilience: a run that dies mid-stream (e.g. the gateway restarting) now surfaces an actionable interrupted state instead of a stuck "thinking" indicator.

### Fixed

- The run-liveness watchdog only armed while a message was queued behind the active run, so a single message whose gateway restarted mid-stream left the thinking bubble spinning until the 120s waiting TTL. It now arms whenever the composer is busy.
- On a confirmed-dead run with nothing queued, the session is marked interrupted so the existing "interrupted — resend" banner replaces the misleading thinking bubble. When a message is queued, the drain effect still owns recovery (no banner, no double-send).

## [2.5.9] — 2026-07-18

Gateway capability-probe resilience and a route-tree warning cleanup.

### Fixed

- Raised the gateway capability-probe timeout from 3s to 8s. The dashboard's `/api/status` is cold (~3s) on the first hit after a (re)boot, which raced the old 3s `AbortSignal` timeout and intermittently flipped `dashboard.available` to false — marking Sessions/Skills/Config/Jobs/Kanban "missing" until a full restart. Warm hits still return in <1s.
- Excluded `-connection-status-cache-helper.ts` from the TanStack route tree (prefixed with `-`) so the router no longer warns on startup about a helper file that doesn't export a `Route`.

## [2.5.8] — 2026-07-17

Dashboard performance patch: paginated session loads and resilient overview rendering, plus matrix-theme polish for the Agent View panel.

### Fixed

- `/api/sessions` now honors explicit `limit`/`offset` instead of exhaustively loading every backend session; unpaginated callers still receive the complete list. Measured request time dropped from ~4s to sub-second.
- The dashboard overview aggregator now applies a 4s per-section timeout, so slow optional upstream cards degrade independently instead of blocking the whole dashboard (~10–15s → ~4s).

### Changed

- Themed the Agent View panel, scrollbar, launcher, and surfaces for the matrix theme.

## [2.5.7] — 2026-07-17

Internal cleanup patch removing disconnected workspace-era features and dormant UI without changing active product behavior.

### Removed

- Retired the unlinked mock Agora preview, its route, active documentation, website references, and Electron bundle payload.
- Removed superseded workspace, gateway agents, approval, research-card, model-suggestion, and shelved terminal/session UI.
- Removed unused settings/dashboard implementations, demo-agent generators, prompt-kit components, and standalone chat/shell affordances.

### Preserved

- Dashboard widget visibility/edit mode and all active dashboard cards.
- Current `/operations`, terminal workspace/panel, chat composer/message list, approval flow, Matrix3D, and shared avatar assets.

### Internal

- Removed 13,612 source/documentation lines across independently reversible commits.
- `pnpm test`: 218 files passed; 1,864 tests passed, 2 skipped.
- `pnpm lint`: passed.
- Vite production application build passed; Electron server bundle regenerated from the cleaned route tree.

## [2.5.6] — 2026-07-17

Chat responsiveness patch focused on eliminating unnecessary work during streaming and long tool-driven conversations.

### Improved

- Stabilized message-list and composer callbacks and rendered nodes so existing React memoization can skip unchanged chat subtrees.
- Removed disabled model-suggestion and typewriter bookkeeping from the chat render path.
- Stopped completed tool cards from subscribing to shared animation and elapsed-time tickers.
- Added a stable-message fast path that avoids repeatedly parsing unchanged message text, thinking, metadata, tool calls, attachments, and timestamps.

### Internal

- Added regression coverage for disabled ticker subscriptions and unchanged-message comparator parsing.
- Targeted chat verification passes: 82 tests plus changed-file ESLint.

## [2.5.5] — 2026-07-17

Focused compatibility and crash-fix patch for profiles and MCP servers.

### Fixed

- **Profile editor crash (#329).** Guarded the wizard's initially empty validation errors so editing a profile no longer crashes while the form is mounting.
- **MCP server availability (#330, #335).** Updated capability detection and native list/create/delete/test proxy paths to use Hermes Agent's `/api/mcp/servers` endpoints instead of the obsolete bare `/api/mcp` paths.

### Internal

- Added regression coverage for the native MCP server endpoint contract.
- Targeted MCP tests pass: 14 tests.

## [2.5.4] — 2026-07-15

Chat streaming fix plus the sub-agent delegations tab and live delegation strip (#331).

### Fixed

- **Streaming bubble re-typed the whole answer on every tool round.** The live streaming message was keyed by its per-message stable id, but that id swaps mid-run between the synthetic `streaming-current` placeholder and the real assistant row the gateway republishes after each tool/code-execution round. Each swap remounted the bubble and reset its reveal state, replaying the full response from scratch ("streams in a loop while execute code runs"). The single live bubble now uses a constant key for the stream's lifetime and only settles to its real id once complete.

### Added

- **Delegations tab and live delegation strip (#331).** Historical sub-agent delegations per session, plus a docked live strip above the composer showing in-flight sub-agent runs with dedup.

## [2.5.3] — 2026-07-13

Stability and release-quality patch: restores a fully green test/lint baseline, fixes dashboard fallback and SSE response handling, removes an unused SSR stream lifecycle, and closes the remaining chat memoization gap.

### Fixed

- **Dashboard fallback diagnostics and recovery.** Dashboard transport failures now retain a stable cause, and internally managed stale authentication receives one safe GET-only token refresh retry. Mutations, caller-provided authorization, timeouts, aborts, and network failures are never retried.
- **SSE response headers.** Removed invalid hop-by-hop `Connection: keep-alive` headers from all seven SSE routes; streaming remains governed by the response body and heartbeat lifecycle.
- **SSR watchdog cleanup.** Enabled TanStack Start SPA mode for the client-only workspace UI, removing abandoned streaming SSR transforms that survived HMR until the 120-second watchdog. Production shell generation uses the stable `/settings` mask path.
- **Chat memoization correctness.** `MessageItem` now compares `clarifyCard`, preventing stale clarification UI when every other memoized prop is unchanged.
- **Duplicate streaming replies.** The realtime `message` → `done` handoff now reuses the current assistant row instead of injecting a second live placeholder with identical text and activity.
- **Session feed filtering.** Restored one clear owner for source/state/search/date filtering and sorting, so sidebar source counts use the complete merged feed.
- **Retro Office navigation.** Preserved the full gym inventory and collision behavior while spacing workout targets around a reachable aisle.
- **Profile update validation.** Preserved initial profile-tier assignment while rejecting later tier mutation and protected-field updates with the correct client error.
- **Test baseline.** Repaired stale expectations, malformed test syntax, JSDOM scrolling behavior, and navigation/filtering regressions.

### Changed

- Cleared the remaining ESLint errors and warnings without adding dependencies or broad abstractions.
- CI lint is now a required gate; failures are no longer hidden by `continue-on-error` or a shell fallback.

### Internal

- `pnpm lint`: 0 errors, 0 warnings.
- `pnpm test`: 209 files passed; 1,817 tests passed, 2 skipped.
- `pnpm exec vite build`: passed and emitted `dist/client/_shell.html` plus the server bundle.
- Closed completed tracking issues #186, #222, #297, and #298.

## [2.5.1] — 2026-07-08

Patch release focused on crash hardening and compatibility fallbacks. Fixes several UI crashes caused by partial async state during chat, Matrix3D/Retro Office, and Conductor renders, and improves the Board Templates fallback when the connected Hermes Agent no longer exposes the upstream Kanban templates API.

### Fixed

- **Chat crash hardening.**
  - Guarded chat display-entry construction when tool/toolResult messages arrive before an assistant display entry exists.
  - Guarded ChatScreen streaming/waiting logic when `finalDisplayMessages` has no trailing message during transient renders.
  - Added regression coverage for empty/waiting and orphan tool-result chat paths.
- **Retro Office / Matrix3D crash hardening.**
  - Guarded render-agent UI/status lookups when the snapshot map is temporarily incomplete on first render or sync boundaries.
  - Tightened partial-map typing so runtime guards match the real data model.
- **Conductor crash hardening.**
  - Rewrote `NowPlayingStrip` to tolerate missing mission subtitle data and render a stable empty/fallback state instead of crashing.
- **Board Templates degraded compatibility state.**
  - Improved `/board-templates` handling when the upstream Hermes Agent returns `404` for `/api/plugins/kanban/templates`.
  - Added a friendlier unsupported state, surfaced the expected upstream endpoint, showed the backend detail, and added a one-click “Copy upstream issue” action.
  - Filed upstream tracking issue: `Interstellar-code/hermes-agent#161`.

### Changed

- Small retro-office cleanup pass to remove leftover warning sites while preserving behavior.

### Internal

- Targeted validation passed:
  - `pnpm vitest run src/screens/chat/components/chat-message-list.test.tsx src/screens/chat/chat-screen.failsafe-timeout.test.ts`
  - targeted ESLint checks for touched release files
- No production build run for this patch release; per repo policy, targeted checks were used instead of full builds for small UI fixes.

## [2.5.0] — 2026-07-04

Major architecture release: 10 new hooks extracted from `chat-screen.tsx`, reducing it from 2,606 to **1,423 lines** (−45% this release, −59% from the #222 triage baseline of 3,431). The chat module now has **20 dedicated hooks** with **200+ unit tests** covering the entire send/receive/retry/redirect lifecycle. All extractions are pure moves — zero behavior changes.

### Changed

- **10 new hooks extracted from `chat-screen.tsx`** (all pure moves, no behavior change):
  - `useActiveRunPoller` — 5s active-run completion poller + 3s live-progress display poller (6 tests)
  - `useComposerSend` — composer onSubmit handler: dedup guard, queue routing, new-chat bootstrap, existing-session send (13 tests)
  - `useActivityStream` — `/api/events` activity-pill EventSource + clear-on-response (6 tests)
  - `useHistoryPolling` — visibility-change bounded poll loop + remount catch-up + chat-refresh listener (9 tests)
  - `useSessionLifecycle` — session-change state reset + consume-pending-send recovery (8 tests)
  - `useMessageRetry` — interrupted-session resend + queue drain effect (6 tests)
  - `useDisplayMessages` — 152-line message display pipeline: filter → sort → dedup → strip wrappers → inject streaming placeholder (19 tests)
  - `useSlashCommands` — all slash commands (`/new`, `/reset`, `/clear`, `/model`, `/skin`, `/skills`, `/save`, `/stop`, `/title`, `/reasoning`) + palette command event listeners (32 tests)
  - `useErrorRedirect` — status query, error signal derivation, session redirect effects, auth-missing redirect (25 tests)
  - `useRetryRecovery` — retry queued messages, flush retryable on disconnect/health-restored (5 tests)

### Removed

- **~300 lines of dead code** absorbed during extraction: `normalizeMessageValue` duplicates, `sanitizeExportToken`, `exportConversationTranscript`, `getMessageClientId`, `getRetryMessageKey`, `isRetryableQueuedMessage`, `getMessageRetryAttachments`, `stripQueuedWrapper` — moved to their consuming hooks or eliminated.

### Internal

- `chat-screen.tsx`: 3,431 → **1,423 lines** (−59% from #222 triage baseline).
- 129 new unit tests this release; 200+ total across the chat hook suite.
- TypeScript: zero new errors across all touched files. Test baseline unchanged (16 pre-existing failures in `apply-filters-and-decorate.test.ts` + `run-persistence.test.ts`).

## [2.4.0] — 2026-07-03

Architecture release: the send-path cluster is fully extracted from `chat-screen.tsx` into a new `useSendMessageState` hook, and ~300 lines of dead SSE connection-state code is removed.

### Changed

- **`chat-screen.tsx` send-path extracted into `useSendMessageState` hook (no behavior change).** The ~155-line `sendMessage` function, 6 SSE callback handlers (`onSessionResolved`, `onStarted`, `onComplete`, `onError`, `onMessageAccepted`, `onAbort`), 2 abort helpers (`handleAbortStreaming`, `reconcileStuckBusyState`), all send-path state flags, refs, and timer/stream-lifecycle functions (`streamStart`, `streamStop`, `streamFinish`, failsafe effects) moved into `src/screens/chat/hooks/use-send-message-state.ts` (730 lines, 23 unit tests). The hook uses RefObject bridges for dependencies produced by hooks called later in render order (`startStreaming`, `cancelStreaming`, `clearCompletedStreaming`, `finalDisplayMessages`, `currentModel`). 3 incremental PRs. (#298)
- **`chat-screen.tsx` reduced from 3,431 to 2,606 lines (−24%).** Combined with the 6 prior decomposition PRs (#290–#296), the god component is now 825 lines smaller than the #222 triage baseline.

### Removed

- **Dead SSE connection-state infrastructure.** The `use-chat-stream.ts` 21-line stub (never called its callbacks), 199-line callback chain in `use-realtime-chat-history.ts`, `ConnectionState` type + `connectionState`/`lastError`/`setConnectionState` store fields (zero production callers), `sseConnectionState` consumer sites in `chat-screen.tsx`, and the `claude:sse-dropped` window listener (no dispatcher existed anywhere in the repo) — all removed after independent Codex verification confirmed 6/7 claims CONFIRMED + 1 PARTIALLY CONFIRMED. The `lastCompletedRunAt` signal was re-wired to the live `streamingState` completion effect (the actual completion-detection path) before the dead `onDone` callback was removed. (#298)

### Added

- **MCP Discover works in fallback mode.** When the dashboard lacks the runtime MCP endpoint, Discover now reuses the `hermes mcp test <name>` CLI path for configured servers instead of hard-failing. Results are cached via `setProbe` so the MCP UI surfaces discovered tools immediately.

### Internal

- 23 new unit tests in `use-send-message-state.test.ts` covering: hook initialization, stream lifecycle (start/stop/finish), sendMessage (optimistic messages, state flags, failsafe timer, startStreaming params, skipOptimistic, attachment payloads), SSE callbacks (onComplete, onError auth-missing + general, onAbort), and abort helpers (handleAbortStreaming, reconcileStuckBusyState).
- TypeScript: zero new errors across all touched files. Test baseline unchanged (416 passed, 16 pre-existing failures in `apply-filters-and-decorate.test.ts` + `run-persistence.test.ts`).

## [2.3.54] — 2026-06-29

Maintenance release: a behavior-preserving decomposition of the chat screen plus tooling and website updates.

### Changed

- **`ChatScreen` decomposed into focused hooks (no behavior change).** The ~3,000-line `chat-screen.tsx` component was split across six PRs into pure helpers and dedicated hooks — `useToolDisplay`, `useFocusMode`, `useThinkingLevel`, `usePendingApprovals` — plus a `ChatNoticeBanners` presentational component. Every moved effect keeps its dependency array verbatim; each PR was diff-reviewed for behavior preservation. Cyclomatic complexity dropped 242 → 199 and cognitive 324 → 272. (#290, #291, #292, #293, #294, #296)
- **Adopted the `codebase-memory` MCP server, removed graphify.** Replaces the prior graphify integration with a tree-sitter + hybrid-LSP knowledge graph; docs and instructions updated. (#289)

### Internal

- New unit test coverage for every extracted chat hook and helper (116 tests across the chat hook/util suites).
- Landing page now details the eight custom plugins.

## [2.3.53] — 2026-06-28

Feature release for chat sessions and message interactions, merged via PR #288.

### Added

- **Quote selected text from a message.** Right-clicking a text selection inside a message bubble adds a "Quote" action that replies with just the selected text, falling back to the full stripped message when nothing is selected. (#288)
- **`recovered` session source.** New source type wired through the sessions classifier, source chips, rail, list, and cards. (#288)

### Changed

- **Sessions list pages past the 1000 cap.** `listAllSessions()` now pages through all gateway sessions instead of returning only the first 1000. (#288)
- **Chat sidebar filters simplified.** Removed the state-segment filter; the date range now defaults to the last 7 days. Filter persistence migrated v4 → v5. (#288)

## [2.3.52] — 2026-06-24

Patch release for three user-facing fixes merged via PR #287.

### Fixed

- **Kanban Claude-backend metadata no longer disappears on round-trip.** Cards now preserve `acceptanceCriteria`, `reviewer`, `missionId`, and `reportPath` by encoding unsupported SQLite-only fields into a tiny hidden metadata header inside `body`, then decoding them on read/update. This closes the field-loss regression on the Hermes-backed board path. (#178, #287)
- **Chat composer send timeout now matches the backend run timeout.** The frontend failsafe moved from 120s to 600s, matching `SEND_STREAM_RUN_TIMEOUT_MS`, so long-running sends no longer prematurely re-enable the composer while the backend is still working. (#122, #287)
- **Blocked update state is now labeled clearly.** The misleading dead-looking `Review required` pill is replaced with a plain `Blocked` status label while keeping the real reason text visible. (#227, #287)

## [2.3.51] — 2026-06-23

Security + stability + cleanup patch. This cut lands a large batch of autonomously-triaged backend, streaming, store, and frontend fixes (PRs #251–#271) on top of two small UI features. All changes were branch-isolated, tsc/lint/test-gated, and adversarially verified before merge. (Two additional security fixes — terminal cwd containment #149/#161 and knowledge-path traversal #156 — remain open as PRs #259/#263 pending human security review and are NOT in this release.)

### Added

- **Skills screen: per-profile filtering.** Skill frontmatter (name/description/tags/triggers/homepage) is parsed and the sidebar filters skills by agent profile with per-profile counts.
- **Tasks screen: sidebar accordions, per-column select-all, and bulk delete.** Filter sections are collapsible; each board column has a select-all control; a two-step-confirm bulk Delete sits in the selection action bar. Removed the static metrics footer.

### Security

- **`/api/events` SSE now requires authentication.** It returns 401 before opening the chat-bus event stream, matching the other SSE routes. (#155, #251)
- **Markdown links and Mermaid rendering hardened.** Rendered anchors run through a scheme allowlist (drops `javascript:`/`data:`/`vbscript:`), and Mermaid initializes with `securityLevel: 'strict'` + `htmlLabels: false`. (#152, #153, #260)
- **CSRF Content-Type guard added to three mutating POST routes.** `hermes-kanban/tasks`, `tasks/:id/comments`, and `workflow-definitions/:id/reset-factory` now reject cross-site form posts. (#158, #261)
- **OAuth token endpoints now require auth + rate limiting.** `oauth.device-code` and `oauth.poll-token` gate on `isAuthenticated` and a per-IP rate limit before any token work. (#160, #262)
- **HTML file-preview iframe contract hardened.** Added `referrerPolicy="no-referrer"` and documented the `sandbox=""` (no-`allow-scripts`) contract so it can't be relaxed by mistake. (#154, #264)

### Fixed

- **Board delete now works.** The board DELETE request was missing `Content-Type: application/json`, so the CSRF guard returned 415 and the confirm dialog hung silently — the header is now sent. (#258)
- **workflow-runs API handlers hardened.** `request.json()` parse failures return 400; auth now runs before the CSRF check (401, not a leaked 415); `cancelRun`/`resumeWorkflowRun` engine errors return 500 instead of throwing. (#157, #159, #162, #257)
- **Timer leaks cleared.** The settings reveal-secret auto-hide timers and the tasks dispatch-result timer are tracked in refs and cleared on unmount/re-schedule, preventing setState-after-unmount. (#163, #167, #256)
- **Zustand rehydrate applies via setState.** `mission-store` and `terminal-panel-store` `onRehydrateStorage` no longer mutate state directly (which skipped subscriber notification); rehydrated values now apply through the store API. (#164, #168, #254)
- **Persist stores are versioned.** Five `persist()` stores gained `version` + `migrate`, preventing stale/incompatible localStorage from hydrating after a shape change. (#172, #255)
- **Atomic file writes for server stores.** `tool-artifacts-store`, `run-store`, and `kanban-backend` writes use a temp-file + rename swap, preventing crash-time truncation. (#142, #148, #173, #252)
- **Timeouts on workflow + provider-usage fetches.** Bare `fetch`/`dashboardFetch` calls in the workflow plugin client, plugin-install probe, and provider OAuth/usage refresh now carry `AbortSignal.timeout`, so a dead endpoint can't hang the operation. (#175, #176, #180, #253)
- **Streaming pipeline resilience.** The active-run tracker now expires entries on a TTL (was an unbounded Set); the live poller stops with a warning after repeated consecutive failures instead of swallowing them silently; the friendly-id header fallback now warns. (#130, #132, #134, #266)
- **Run-store and tool-artifacts concurrency/bounds.** `updatePersistedRun`'s read-modify-write is serialized with a per-run async lock (concurrent SSE events no longer lose updates); the tool-artifacts index is capped with oldest-first eviction plus a per-session cleanup. (#141, #143, #267)
- **Frontend store correctness.** A stale-closure in the agent-view usage effect is fixed via `useCallback`; the mission-store `beforeunload` checkpoint is now actually registered; task IDs use `crypto.randomUUID()` with a bounded persisted-task cap. (#165, #166, #169, #269)
- **Config read is cached.** `/api/connection-status` mtime-gates the `config.yaml` read instead of re-parsing on every poll. (#136, #270)
- **Agent/workspace update re-checks the working tree before reset.** `applyAgentUpdate`/`applyWorkspaceUpdate` now re-run the dirty-tree check immediately before `git reset --hard`, refusing to reset (and destroy uncommitted changes) if the tree is dirty. (#179, #271)

### Changed

- **Shared stream-parsing utilities extracted.** `readString`/`readRecord`/`parseJsonIfPossible`/`stripDataUrlPrefix` are unified in `src/lib/stream-utils.ts` (deduped across send-stream paths; one typed signature each). (#139, #140, #265)
- **Dead backend code removed.** Removed the unused server `tasks-store` CRUD exports (Kanban cutover left them orphaned), a redundant `resolveKanbanBackend` branch, and the no-op `ensureBusStarted`. (#151, #171, #182, #268)

## [2.3.50] — 2026-06-22

Security + stability patch release. This cut includes the five human-merged backend fixes from PRs #246–#250 and rolls forward several recent mainline fixes/features that were already landed but not called out clearly in the previous release notes.

### Changed

- **Memory wiki cutover now consistently targets Matrix Memory.** The Memory wiki/chat/settings surfaces now use Matrix Wiki naming consistently, and knowledge-base config resolution upgrades legacy Hermes wiki paths to the profile-scoped Matrix Memory wiki root when that migrated location exists.
- **Tasks filters can now hide Ready and Running columns too.** The existing visible-column filter controls now cover `ready` and `running` in both the sidebar and mobile filter popover, with the same persisted behavior as the older triage/blocked/done/archived toggles.

### Fixed

- **Local-session touches now persist to disk.** `touchLocalSession()` now schedules a save after updating `updatedAt`, so recency ordering survives server restarts instead of reverting after in-memory-only writes. (#144, #246)
- **Dashboard-proxy mutating routes now enforce the JSON CSRF guard.** POST/PUT/PATCH/DELETE requests to `/api/dashboard-proxy/*` reject browser-form content types before proxying gateway mutations. (#147, #247)
- **Task-store writes are now atomic.** `tasks.json` writes through a same-directory temp-file + rename swap, preventing crash-time truncation/corruption and allowing per-test `HERMES_HOME` path overrides. (#145, #248)
- **`/api/media` no longer allows arbitrary filesystem reads.** Media requests are now constrained to `HERMES_HOME/uploads` and the workspace `files/` directory, with traversal/out-of-root paths rejected. (#146, #249)
- **Password verification no longer leaks configured-password length.** `verifyPassword()` now hashes both sides to fixed-length SHA-256 digests before `timingSafeEqual()`. (#150, #250)
- **Commands badge counts no longer stick at zero.** The Commands navigation badge now reflects the real pending-command total. (#241, #242)
- **Workflow review items now map to a valid Kanban column.** The `review` status is normalized to `triage`, avoiding invalid board-state regressions. (#174, #245)
- **Three.js deprecation noise is gone.** The app now pins `three` to `0.182.0`, eliminating the `THREE.Clock` warning churn in 3D surfaces. (#204, #244)

## [2.3.49] — 2026-06-21

Memory gets a new Browse tab backed by Mnemosyne stats, and the recovered chat context-menu fixes are now merged into main.

### Added

- **Memory › Browse tab.** The Memory screen now includes a Browse tab with SQLite-backed Mnemosyne stats for the active bank, including working-memory, episodic-memory, triple, and FTS row counts via a dedicated `/api/memory/stats` route. The UI is styled to match the existing Matrix/Memory theme instead of introducing a separate dashboard visual language.
- **Chat message right-click menu.** User and assistant bubbles now expose a context menu with Copy, Reply, and Retry actions where applicable.

### Fixed

- **Mnemosyne database path resolution.** Stats lookup now prefers the real Matrix-memory profile database (`~/.hermes/profiles/hermes-switch/matrix-memory/data/mnemosyne.db`) and falls back through the older root-path candidates. Missing databases return a calm zero-state payload instead of a noisy hard failure.
- **Sidebar session-card context menu reliability.** The V2 sidebar session menu now portals to `document.body` and clamps to the viewport, fixing the cases where right-click/three-dot menus appeared misplaced or invisible inside transformed virtual rows.
- **Memory browse typography/theme alignment.** The new Browse presentation now uses the tighter mono sizing, flatter panels, and existing Memory-page rhythm expected across similar Matrix screens.

## [2.3.48] — 2026-06-14

Board Templates gains a grid/table datatable with pagination and per-template task counts. Sidebar nav items now show live counts, and Boards gets an "Open Tasks" shortcut.

### Added

- **Board Templates grid/table views + pagination.** The Templates page now offers a **Grid/List** view toggle (persisted to `localStorage`) modelled on the Profiles page — a responsive card grid alongside the existing table — with a pagination footer (per-page size selector + first/prev/page/next/last navigation). Search resets to page 1.
- **Template task-count column.** Each template shows its number of tasks — a **Tasks** column in the table and a stat on each grid card. Counts are fetched per visible page (bounded fan-out) and cached, sharing the template-detail cache.
- **Sidebar item counts.** The primary nav shows live count badges on Chat, Jobs, Tasks, Templates, Workflows, Commands, Skills, MCP, and Profiles. Counts fetch lazily (only while the nav is expanded) and hide on error.
- **Boards "Open Tasks" action.** Board cards and list rows gain an **Open Tasks** button that switches to the board and opens its Kanban tasks directly — the same action as the drawer's Open Board, surfaced inline.

### Fixed

- **Tasks nav badge** now reflects the current board's task count instead of the number of boards.

## [2.3.47] — 2026-06-13

Board Templates: per-task scheduled-start times, a refreshed instantiate form, and faster loads. Plus removal of the system metrics footer.

### Added

- **Per-task scheduled start (`scheduled_at`).** The template task editor (Advanced section) gains a deferred-dispatch control with a mode toggle — **Immediately / After delay / At date-time / From variable** — producing the three backend-accepted forms: a relative offset (`+2h`, `+30m`, `+1d`, `+1w`), an absolute date/time (unix epoch), or a `{{variable}}` resolved at instantiation. Inline validation mirrors the backend (`+<n><unit>`, positive epoch, or `{{var}}`); the value round-trips through create/edit and gates the wizard. Verified end-to-end against a live board: deferred tasks are held from dispatch until their time passes. (#231)

### Changed

- **Instantiate ("Use Template") modal redesign.** Variables now lay out in a responsive 2-column grid; each field carries an `(i)` tooltip (Base UI) instead of verbose inline captions. Required-but-empty fields show a clear invalid state; the auto-dispatch toggle gained an explanatory hint; the post-instantiate result link switches to the new board before navigating to Tasks.
- **Removed the system metrics footer** and its settings toggle (`system-metrics-footer` component, settings-dialog entry, and `use-settings` flag).

### Fixed

- **Board Templates load performance.** Added a 20s client-side fetch timeout (surfaced as a clean 504 instead of an indefinite spinner), a 30s `staleTime` so revisits serve cached data with no spinner, a Retry button on the error state, and a multi-child error-layout fix.

## [2.3.46] — 2026-06-12

Board Templates: guided wizard for template creation, plus per-task runtime/turn controls.

### Added

- **5-step template creation wizard.** The Board Templates page now creates and edits templates through a guided wizard — Basics (name, auto-slug, description, color) → Variables → Tasks → Dependencies + Recurrence → Review — replacing the raw-YAML drawer (kept as an "Advanced" escape hatch). Tasks expose status (`todo`/`ready`), priority, assignee, body with `{{variable}}` insertion, and an Advanced section for `max_runtime_seconds`, `goal_max_turns`, and `goal_mode`. The Dependencies step adds a parent→child link editor with live self-link/duplicate/cycle guards; the Review step runs a pre-commit checklist and shows a YAML preview before save. Backend validation errors (413/422/409) are surfaced cleanly. (#231 follow-up)
- **Per-task `max_runtime_seconds` and `goal_max_turns`.** Optional positive-integer fields on template tasks, round-tripped through create/edit/instantiate. The save-as-template keep-status copy now reflects ready-only preservation. (#233)

## [2.3.45] — 2026-06-12

Kanban Board Templates: manage reusable board definitions and instantiate them into live boards.

### Added

- **Board Templates management page.** New Templates sub-page under Tasks (`/board-templates`) for the Hermes Agent Kanban templates backend (hermes-agent #135 P2). Lists installed templates (name, slug, variables, recurrence); create/edit via a raw-YAML editor with 64 KB guard and inline validation-error surfacing; delete with confirm. **Instantiate** modal collects per-variable values (`{{key}}` substitution), optional target board and auto-dispatch, then shows created/skipped counts with a link to the new board. Recurrence is shown read-only with an enable/disable toggle (no cron authoring). A **Save as template** button in the `/tasks` board header snapshots a live board. Page hides/degrades cleanly when the backend predates templates (404) or the Kanban capability is absent; backend error details (413 oversized, 422 validation, 409 refused) are surfaced, not raw. Built to the live-verified gateway contract. (#231)

## [2.3.44] — 2026-06-12

Chat hot-path performance overhaul, the recurring "Too many re-renders" crash contained and fixed, and the new Hermes Plugin settings section with backend config-sync.

### Added

- **Hermes Plugin settings section + backend config-sync.** New `/settings` section surfacing the bundled `hermes-switch-ui` backend plugin: status pill with heartbeat age, connection info (ports, profile, enabled plugins), reported settings, and a version-compatibility banner with an explicit "unknown until registered" state. The workspace server registers with the backend on startup and heartbeats every 30s (register-gated, `globalThis` singleton, 60s backoff), and mirrors an allowlist of saved UI settings — secrets never leave the workspace. Degrades cleanly: "plugin not enabled" (confirmed 404) and "backend unreachable" (timeout/5xx) are distinct states with their own poll cadences. Stale incompatible compat verdicts self-heal via a 10-minute re-register window. (#228, #229, #230)
- **Self-Improve narrative UX redesign.** Single global profile scope, merged Experiments feed, hero diff, lifecycle stepper, score context, and scenario checklist. (#210, #211)
- **Composer paste keeps formatting.** Pasted HTML converts to Markdown instead of flattening to plain text; rendered tables get a copy button.
- **Crash diagnostics that survive reload.** The error boundary now captures the React component stack, shows "Crashed in: …" in the error card, persists the last 3 crashes to `localStorage['hermes:ui-crash-log']`, and adds a Copy-details button.

### Fixed

- **The recurring "Too many re-renders" chat crash is contained and root-caused.** The new crash log pinpointed `AnimatePresence` inside `AgentViewPanel` (duplicate agent-id keys from merged CLI+mission sources break motion's child diff). Active nodes are now deduped by id, and the panel is isolated in an inline error boundary — a panel crash degrades to a small retry card instead of taking down the whole chat route. (#225, #226)
- **Streaming no longer re-renders the entire message list every animation frame.** Live streaming text was embedded in the same array as historical messages, defeating list memoization ~60×/sec; it now reaches only the streaming bubble via a dedicated prop, and the duplicate rAF typewriter loop was removed. (#212)
- **Session-list cache desync.** Rename, auto-title, and session-create only invalidated one of the two session caches, leaving the V2 sidebar stale; all mutation sites now invalidate both via one helper. (#218)
- **Session-switch mid-stream race.** Realtime buffers are cleared deterministically on switch (the disabled cleanup effect and 5s timer are gone), fixing ghost messages and unbounded buffer growth. (#220)
- **Gateway failures no longer masquerade as an empty chat.** All gateway/dashboard HTTP helpers carry 10s timeouts, and `/api/history` returns 503 instead of HTTP 200 with `messages: []` when the fetch fails — cached history stays visible. (#217)
- **Composer busy state could go stale.** Now a reactive store subscription instead of a non-subscribing `getState()` read; dead legacy computation removed. (#219)
- **MessageItem stale renders.** The memo comparator now covers `attachedToolMessages` and `isLastAssistant`. (#222)
- **Plugin registration sent version `unknown`.** `require()` is unavailable in the Vite SSR runtime; the version now comes from the `__APP_VERSION__` build-time define.

### Performance

- **Long threads render windowed.** Threads over 80 entries render the last 60 plus a "Show N earlier messages" expander (search auto-expands; the pinned group never collapses). (#213)
- **Poller/timer consolidation.** The 3s live-progress poll skips while SSE is connected; the approvals poll backs off 2s→20s when idle; all tool-card timers derive from at most 3 shared tickers (was ~2 per card); `session-status` caches `getConfig` for 30s. (#214)
- **chat-store hot path.** Messages append in order with a sort only on detected out-of-order arrival (WeakMap-cached event times); streaming state persists per-session debounced instead of per-token; the internal-message filter is unified. (#221)
- **In-stream live-tool poll widened 800ms→1500ms**; gateway `since`/`offset` pagination tracked in #215/#216.
- **Idle network traffic cut ~5×.** `/api/sessions` poll 5s→30s (~400KB per tick) and gateway activity poll 3s→10s. (#225)

## [2.3.43] — 2026-06-11

Dynamic website version badge and sidebar last-activity ordering.

### Added

- **Marketing-site version badge is now fetched at runtime.** It was baked at build time via the `PUBLIC_SITE_VERSION` vite define, so it froze at the last deployed version until a manual rebuild+rsync. It now mirrors the GitHub-stars badge: the build-baked value renders initially (no flash, works without JS), then the nav pill, hero badge, and footer are patched from `GET /repos/Interstellar-code/hermes-switchui/releases/latest` (`tag_name`), sessionStorage-cached for 10 minutes to respect the unauthenticated rate limit. The badge now tracks the latest GitHub release with no site redeploy. (The hero terminal boot line stays build-baked — it animates before any API round-trip resolves.)

### Fixed

- **Resumed chats now jump to "Today" in the V2 sidebar on send.** The sidebar already buckets by `last_active`, but nothing refetched the feed after a send, so a resumed older session stayed in its old date group for the 30s stale window until an incidental refetch. The feed is now invalidated in the stream-end handler so it reorders the moment the assistant response completes, plus a 60s background refetch so sessions resumed from external clients (cron/cli/a2a) reorder too.

## [2.3.42] — 2026-06-11

Matrix3D agent-activity reliability and 3D-canvas/console-error fixes.

### Fixed

- **Matrix3D crew characters now reflect real per-agent activity.** The tier-2 characters (MORPHEUS/NEO/TRINITY) were stuck out of sync because all three legacy "working" signals were dead: the gateway never supported `?profile=` session filtering, the `delegate_task` payload carries no agent identity (so the `"you are <name>"` heuristic never matched), and name-fuzzy matching scored zero against UUID session keys. Crew activity is now derived from per-profile `state.db` ground truth (recent `messages.timestamp` within a 180s window, `ended_at`-guarded, ms-normalized) plus a deterministic, stable avatar assignment of active delegated child sessions (`src/lib/crew-delegation.ts`). Working agents without an open UI stream now route to a desk with their own task text instead of replaying the main agent's bubble. This is an interim DB-backed fix; the push-based replacement is tracked in #202 / hermes-agent#132.
- **3D office no longer loses its WebGL context.** `canvasResetKey` fed the `<Canvas>` React key from frequently-changing reactive values (`agents.length`, `gatewayStatus`, `officeCenterSignal`), so every agent-count change, gateway reconnect, or recenter destroyed and remounted the Three.js renderer — exhausting the browser's ~16 WebGL-context cap and throwing `THREE.WebGLRenderer: Context Lost`. The key is now just `remoteOfficeEnabled`; recenter keeps working through its existing imperative `useEffect`. (#203)
- **Kanban boards no longer 503 on archived queries.** `GET /api/hermes-kanban/boards?include_archived=true` returned a 503 on every call (~5s) even though the upstream dashboard answered 200 in ~31ms. The `kanbanFetch` 5s `AbortSignal` was shorter than the worst-case double HTML-scrape auth retry (2×`PROBE_TIMEOUT_MS` = 6s), so the abort fired mid-auth and a synthetic 503 was returned. Raised to `KANBAN_FETCH_TIMEOUT_MS = 12_000`; fast calls are unaffected. (#205)

## [2.3.41] — 2026-06-10

Expose the new Plugins docs on the marketing/Starlight site.

### Fixed

- **Plugins docs now appear on the deployed docs site.** The Astro Starlight site (`website/`) sources pages from the repo `docs/` via a glob loader and a manual sidebar — neither included the new `plugins/` tree, so the section was missing from `hermes-switchui.zi0n.space/docs`. Added `plugins/**` to the content glob (`website/src/content.config.ts`) and a Plugins group (after MCP) to the Starlight sidebar (`website/astro.config.mjs`). The Matrix Coder intent-detection diagram renders via the existing `/api/docs-asset` → `/docs-assets` iframe rewrite.

## [2.3.40] — 2026-06-10

Docs plugins section, plus a website version-display fix.

### Fixed

- **Website version now updates with every release.** `website/astro.config.mjs` had two `vite:` keys in the same config object; the second silently overwrote the first, so the `PUBLIC_SITE_VERSION` `define` never applied and every site label fell back to a frozen literal (`2.3.38`). The blocks are merged, so the nav badge, hero badge, install terminal, and footer now reflect the real package version.

### Added

- **Docs › Plugins section.** A dedicated Plugins group in the docs sidebar (after MCP) documenting the four custom Hermes Agent plugins bundled with Switch UI: A2A Fleet, Workflow Engine, Lazy Load MCP, and Matrix Coder.
- **Matrix Coder intent-detection docs + diagram.** The Matrix Coder page now explains how the `pre_llm_call` hook decides whether a specialist persona activates (explicit trigger ▸ implicit inference ▸ no-op), with an architecture diagram of the full routing path.

## [2.3.39] — 2026-06-10

Cron run-history reliability release.

### Fixed

- **Cron job mutations send a valid JSON body.** Bodyless POSTs (e.g. "Run now") now send `{}` so SwitchUI's `application/json` CSRF check no longer rejects them with a Content-Type error.
- **Cron deletes reach the jobs backend.** Delete requests are routed to the gateway jobs endpoint instead of failing silently.
- **Cron run history stays in sync with linked chats.** The detail drawer and the dashboard-backed history now read from the same `/api/cron/jobs/:id/runs` source instead of disagreeing.

### Changed

- **Cron history falls back gracefully when `/runs` is unavailable.** When the gateway only advertises `/api/cron/jobs` (no `/runs` endpoint), the jobs page surfaces the latest run from job detail instead of showing nothing.
- **Cron run sessions are named from their jobs and linked by run ID.** Run history and session search resolve cron chats by discovered `chatSessionKey` first, then fall back to `cron_<jobId>_<timestamp>` IDs, so runs link to the right conversation.

## [2.3.38] — 2026-06-10

Version alignment release for the website/docs deployment.

### Fixed

- **Website version display now follows the root package version for direct Astro builds.** `website/astro.config.mjs` reads the root `package.json` and injects `PUBLIC_SITE_VERSION`, so standalone Virtualmin deployments no longer fall back to stale hard-coded labels.
- **GitHub release/version drift is resolved.** This patch becomes the canonical latest release after the website/docs Matrix styling deployment, keeping package metadata, the live website badge, git tag, and GitHub Releases aligned.

## [2.3.37] — 2026-06-10

Astro/Starlight docs rendering is cleaner for authoring examples and starts with a quieter sidebar.

### Fixed

- **Markdown image examples in the website docs authoring guide no longer look like broken images.** The authoring guide now keeps the `![alt](...)` examples inside valid markdown code fences, so Starlight renders them as examples instead of attempting to interpret them as content.
- **The Mermaid authoring sample is now a proper fenced-code example again.** The instructional Mermaid block is displayed as markdown source, while the separate rendered example continues to become an SVG diagram.
- **Website docs sidebar groups default to collapsed.** Starlight sidebar groups are now generated with `collapsed: true`, so `/website/docs/...` loads with a compact left navigation instead of every group expanded.
- **Website docs sidebar links no longer double-prefix the site base.** Starlight already includes the Astro `SITE_BASE` in generated hrefs, so the docs prefixer now strips that base before adding `/docs`; links now resolve to `/website/docs/<slug>/` instead of `/website/docs/website/<slug>/`.

## [2.3.36] — 2026-06-09

Website docs now stay inside the embedded `/website/docs/...` Starlight preview and render diagrams with more usable horizontal space.

### Added

- **Mermaid diagrams render in the Astro/Starlight docs build.** The website build ships a local Mermaid runtime under the site base, rewrites Mermaid fences into client-rendered diagram containers, and includes a live rendered example in the docs authoring guide.

### Fixed

- **Website Docs navigation no longer jumps to the Switch UI app docs.** Website docs links, sidebar entries, docs asset URLs, and the docs index redirect are base-aware, so the embedded preview keeps navigation under `/website/docs/...`.
- **Large embedded HTML diagrams have more room in Starlight.** The generated docs page now narrows the right table-of-contents rail to match the left sidebar and expands the main content area, so iframe diagrams render at a much wider viewport.

## [2.3.35] — 2026-06-09

Website/docs split is now clean: app docs stay at `/docs`, the Astro site builds from the root `docs/` tree, and the embedded `/website` preview works again inside Switch UI.

### Added

- **Website docs now use the repo-root `docs/` folder as their single source of truth.** Starlight loads the canonical markdown from `docs/`, builds website docs under `/docs/...`, and syncs diagrams/images/screenshots into static `/docs-assets/...` so the website no longer depends on app-only `/api/docs*` endpoints.

### Fixed

- **Embedded `/website` preview inside Switch UI was broken by wrong asset base paths.** The Astro build was emitting module URLs that did not line up with the app-served `/website/...` route, so the browser fetched HTML instead of JavaScript and failed strict MIME checks. `build:website` now builds with `SITE_BASE=/website`, and the embedded preview serves JS from `/website/_astro/...` correctly again.
- **Website docs duplicated both `/docs/...` and root-level doc routes.** Postbuild cleanup now removes the duplicate root doc outputs after Starlight generation, rewrites sitemap entries, and rebuilds Pagefind from the cleaned `dist` so the public website exposes only `/docs/...`.
- **Some canonical docs pages could not be loaded by Starlight.** Missing frontmatter was added to the remaining markdown files that lacked required `title`/`description` metadata, and unsupported fenced `env` blocks were normalized so the shared root docs tree builds cleanly in the website pipeline.

## [2.3.34] — 2026-06-09

Regression fix: Task sessions disappeared from the sidebar after the 2.3.33 CLI/A2A change.

### Fixed

- **Task chip went empty after 2.3.33.** The CLI/A2A classifier branches were evaluated before the `isTaskTriggered` heuristic, so kanban-task sessions that run via the CLI (source `cli`) were reclassified out of the Task chip into CLI. `task` is a heuristic overlay that can ride on any source, so it is now checked before `cli`/`a2a` (still after telegram/cron/api). Task sessions are back; only non-task CLI/A2A land in the new chips.
- Hardening: extracted the classifier into an exported pure `classifySessionSource()` and deleted the test's drifted copy (which had silently kept the old order and asserted the bug). The test now exercises the real classifier, so this regression can't pass green again.

## [2.3.33] — 2026-06-09

CLI and A2A sessions are first-class in the sidebar, more session types are deletable, and console noise is gone.

### Added

- **CLI and A2A sessions are now first-class sources.** Sessions started from the Hermes CLI (`cli`, 116) and A2A fleet runs (`a2a_fleet`, 55) were classified into the generic "chat" bucket — reachable but indistinguishable and unfilterable. They now have their own classifier branches and sidebar chips (CLI teal, A2A violet) with rail colors, matching how Telegram/API are handled.

### Fixed

- **Delete was unavailable for Telegram, CLI, and A2A sessions.** The row context menu gated Delete/Rename on a stale allowlist (`chat`/`cron`/`api`/`task`) that omitted `tg`, `cli`, and `a2a`, so those sessions offered only Archive. All are backed by ordinary gateway sessions and share the same `DELETE /api/sessions/<id>` path; the allowlist now includes them.
- Removed a dead `s.key.startsWith('api-')` classifier fallback (no current session id uses that prefix).

### Changed

- Removed an unconditional `tap-debug` `console.info` that logged `[tap-debug:chat-main] toggle via overlay…` on every chat mount.
- CI: the Docker publish workflow now frees ~25GB of unused preinstalled toolchains before buildx, preventing the intermittent `ResourceExhausted: no space left on device` failures at the image-export stage.

## [2.3.32] — 2026-06-09

Telegram sessions are clickable, the updater stops false-nagging, and a dashboard console warning is gone.

### Fixed

- **In-app updater falsely offered updates (and could destroy local commits).** The updater advertised an update whenever local git HEAD differed from the remote HEAD — direction-blind — and showed the "local changes, commit/stash" block whenever the checkout was dirty, even with no update pending. On a checkout ahead of or diverged from origin this nagged constantly, and the offered update runs `git reset --hard origin/<branch>`, which would have destroyed unpushed local commits. An update is now offered only when local is strictly **behind** remote (local HEAD is an ancestor of the remote tip), and the dirty-block only appears when an update actually exists. Decision logic extracted into pure unit-tested helpers (`isUpdateAvailable`, `resolveUpdatePresentation`). Applies to both the Switch UI and Hermes Agent update paths.
- **Telegram sessions were not clickable in the V2 sidebar.** `isChatItem` omitted `src === 'tg'`, so Telegram rows fell through to the non-clickable branch instead of the `<Link to="/chat/$sessionKey">`. They share the same chat key/route as every other source; adding `'tg'` makes them open normally.
- **recharts `width(-1)/height(-1)` console warning on the dashboard.** recharts 3.x defaults `ResponsiveContainer` `initialDimension` to `{-1,-1}` for SSR; set `initialDimension={{width:1,height:1}}` on the initial-mount chart.

## [2.3.31] — 2026-06-09

Embedded docs flow diagrams render again instead of downloading.

### Fixed

- **Flow diagrams on `/docs` pages downloaded instead of rendering.** The security hardening in `6480a703` (#111) added a blanket `Content-Disposition: attachment` for `.html`/`.svg` served by `/api/docs-asset`, which also caught the first-party flow diagrams the docs embed via `<iframe src="/api/docs-asset?path=diagrams/*.html">`. The diagrams are static, in-repo, and script-free, so they are now served inline: `docs-asset.ts` exempts the `docs/diagrams/` subtree from force-download (tight CSP — no script source, inline + Google Fonts styling only — plus `X-Frame-Options: SAMEORIGIN`), and `docs-render.ts` rewrites the docs-asset iframes to carry `sandbox=""` + `referrerpolicy="no-referrer"`. Arbitrary `.html`/`.svg` anywhere else is still forced to download.

Security posture unchanged for every path except the trusted `docs/diagrams/` subtree, which now renders inside a sandboxed iframe.

## [2.3.30] — 2026-06-09

Gateway startup reliability: find the renamed `hermes` binary and honor a custom gateway port.

### Fixed

- **"hermes-agent not found" on fresh Interstellar installs.** `resolveClaudeBinary()` only looked for a `claude` binary under `~/.claude/bin` and `~/.local/bin`, but the Interstellar fork installer ships the gateway CLI as `hermes` (to `~/.hermes/bin` or `~/.local/bin`). A correctly installed gateway was reported missing and `startClaudeAgent()` returned the installer error. Resolution now checks the `hermes` locations first, keeps the legacy `claude` paths as a fallback, and finally does a `PATH` lookup (`hermes` then `claude`).
- **Gateway connection failure on non-default ports.** The health probe and uvicorn fallback launch hardcoded port `8642`, so a gateway on any other port could not be detected. New `resolveGatewayPort()` / `resolveGatewayUrl()` derive the target in priority order: `HERMES_API_URL` / `CLAUDE_API_URL` → `API_SERVER_PORT` in `~/.hermes/.env` → default `8642`. `isClaudeAgentHealthy()` now probes the resolved base URL, so the health check matches where REST traffic already goes.

Runtime-only change — no migration. Installs running the local agent on `8642` with no env override resolve to exactly the previous values and are unaffected.

## [2.3.29] — 2026-06-09

Sidebar session delete reliability, Telegram session visibility, and chat source-tab counts.

### Fixed

- **Sidebar session delete now refreshes the list.** Deleting a session removed it on the backend but left the card visible, because the V2 sidebar renders from a separate TanStack Query cache (`['sessions-feed','chat','v3-task-split']`) than the delete mutation invalidated (`['chat','sessions']`). The feed key is now exported as `SESSIONS_FEED_KEY` and invalidated on mutate/error/success, with tombstone filtering for instant optimistic removal. The delete dialog no longer unmounts mid-request, and gateway-owned sessions (e.g. cron) the dashboard 404s now fall through to the gateway DELETE (404 treated as success).
- **Telegram sessions now appear in the sidebar.** The feed classified sessions by key-prefix only, so timestamp-keyed Telegram rows fell into the `chat` bucket and the `tg` filter chip stayed empty. The feed now classifies by the authoritative gateway `source` field (`telegram → tg`); `source` is preserved through `normalizeSessions` and typed on `SessionMeta`; the TELEGRAM chip shows whenever it has items.

### Changed

- **Chat meta bar slimmed.** Removed the redundant total-token field (the context-window ring already shows it) and the api-call count.
- **Source tabs show counts.** The chat / tool / skills tabs now display message, tool-invocation, and skill-invocation counts. Skill count uses a shared `countSkillEntries` helper so the badge and the skills tab agree.

## [2.3.27] — 2026-06-07

Shadcn composer cutover at /chat + reply / queue / tool-display features.

### Added

- **shadcn/ui is now the default chat composer at `/chat`** (#187, #189). The base-ui `ChatComposer` has been replaced by a new `ChatComposerShadcn` that reuses the same `ChatComposerProps` / `Handle` / `Helpers` / `Attachment` contract and delegates all send/streaming logic to `chat-screen`. Coexistence guardrail holds: shadcn lives only under `src/components/shadcn/ui/`, base-ui stays under `src/components/ui/`, and all shadcn primitives inherit the 13-theme palette via the `--theme-*` token bridge in `src/styles.css`. Phase 0 (`feat(ui): shadcn/ui Phase 0 — isolated coexistence + token bridge`) and Phase 1 plan executed end-to-end (see `.omc/plans/shadcn-adoption.md`).
- **Tool-display 3-state toggle.** A new footer button on the composer cycles tool-section visibility `expanded → collapsed → hidden` (with a distinct icon + label + muted styling per mode). State is persisted to `localStorage` under `switchui:tool-display-mode` and per-message rendering skips the entire tool-section block in `hidden` mode. Maps to the operator1 `setToolDisplayMode` cycle.
- **Reply-to quote.** A new `Reply` button on `MessageActionsBar` quotes the target message into the composer; outgoing messages are prepended with a styled `> [Re: #N]` blockquote (left-accent `border-l-2 border-primary`, `CornerUpLeft` icon) — the raw marker is kept in the outgoing text for LLM context and reload persistence.
- **Reply chip + system-message toggle + new-chat button.** Dismissible reply chip above the textarea; `Eye`/`EyeOff` toolbar button hides system messages; `SquarePen` toolbar button issues a `navigate({ to: '/', replace: true })` new-chat.
- **Queue composer sends while streaming.** Per-session persisted FIFO queue: stage sends during an active stream, drain FIFO as each response completes. The native Hermes `/queue` is client-coordinated and returns `{type:send}` over REST+SSE, so this client-side FIFO is functionally equivalent.
- **Toolbar parity** on `ChatComposerShadcn`: profile, workspace, thinking-level (with Shift-click quick-cycle), fast-mode, web-search, and live model switch (per-session persistence + gateway `switchModel` with the zero-fork guard). Reuses the live composer's exported helpers/types — no behavior duplication.
- **Cherry-picked sandbox composer features** (now live in the cutover composer): auto-growing textarea with Enter-to-send / Shift+Enter-newline, caret-anchored slash (`/`) + `@` autocomplete popover (shadcn `Popover` + `Command`), image paste + file-picker attachments (with thumbnail chips), reply-to chip, message queue with start/stop/clear (persisted to `localStorage`), color-coded live context counter, and an inline agent + session badges row with a provider-grouped model selector popover.
- **shadcn composer primitives** under `src/components/shadcn/ui/`: `button`, `popover`, `tooltip`, `dialog`, `command`, `input`, `textarea` (all generated via `shadcn@4.10.0`). Radix deps (`@radix-ui/react-popover`, `@radix-ui/react-tooltip`, `@radix-ui/react-dialog`) and `cmdk` installed as direct dependencies.

### Changed

- **Selectors relocated from composer toolbar to meta bar.** Model / profile / workspace / thinking dropdowns moved out of `ChatComposerShadcn` into a new self-contained `SessionSelectorsV2` component rendered by the meta bar. Composer toolbar is now icons + context ring + send only. The meta bar now highlights the 4 relocated selector chips with an accent border + subtle accent fill so they read as interactive controls, and drops the read-only status (tok/s, model echo, ctx%, token count, tools) to remove the confusing double model indicator. The composer still owns thinking-level (read-only) for the fast-mode gate.
- **Reply reference redesigned** as a styled quote block (bg-muted, `border-l-2 border-primary`, `CornerUpLeft` icon) above the message body instead of being inlined as raw `> [Re: #N]` markdown.
- **Composer image compression pipeline ported** to `ChatComposerShadcn` (helpers exported from the live composer; 50 MB size cap, canvas compression with graceful fallback).
- **Sandbox composer artifacts removed** at cutover: the `switchui:shadcn-composer` feature flag, the `/composer-preview` dev route, and the `composer-shadcn/` sandbox directory are deleted (route tree regenerated). The previous `ChatComposer` is kept on disk for revert only.

### Fixed

- **Runtime `React is not defined` at `/chat`** — the tool-display toggle wiring used `React.useCallback` against an unimported `React` global; switched to the already-imported named `useCallback`, and added the missing `ToolDisplayMode` type import.
- **Add-to-queue button rendered as washed-out `secondary` on Matrix dark** — the button uses `primary` variant to match the send button, since queueing is the primary action while streaming.
- **Composer docked flush to viewport bottom** — restored outer padding `px-3 pt-2 pb-6 sm:px-5 md:pb-8` so the composer has the same bottom gap as the original.
- **Reply preview showed raw markdown** — table pipes / headers stripped so the quote snippet reads as clean prose.
- **Reply quote dumped the full multi-line message** — collapsed whitespace and capped at 140 chars with ellipsis so it renders as one clean blockquote line.

## [2.3.26] — 2026-06-05

Website served in-app.

### Added

- **`/website` serves the Astro marketing site.** The bundled `website/` Astro site is now reachable at `http://localhost:3000/website/` from the app (dev and production node). New splat route `src/routes/website.$.ts` serves `website/dist/` (content-typed, path-traversal-guarded, public/no-auth) with `website.index.ts` for the bare path.
- Astro `base` is env-driven (`SITE_BASE`): the app build (`build:website`) builds with `base: /website`; the VPS deploy keeps `base: /` (root). `pnpm build` now builds the website before `vite build`.

### Notes

- Docker: `.dockerignore` excludes `website/`, so `/website` won't serve inside the Docker image yet — a separate follow-up.

## [2.3.25] — 2026-06-05

Security + tooling.

### Security

- **Cleared 4 moderate `hono` advisories** (GHSA-3hrh-pfw6-9m5x, GHSA-f577-qrjj-4474, GHSA-2gcr-mfcq-wcc3). `hono` was a transitive peer of `@hono/zod-openapi` resolving to the vulnerable 4.12.18; pinned `hono` as a direct dependency at `^4.12.23`. `pnpm audit` is now clean.

### Changed

- Bumped `@tanstack/eslint-config` 0.3.4 → 0.4.0 (lint tooling current; no behavior change). Repo-wide lint debt tracked in #186.

## [2.3.24] — 2026-06-05

Fresh-install fixes: MCP page + File Manager.

### Fixed

- **MCP servers page empty on fresh installs (#185).** The `mcpFallback` capability gate required the agent's `config.yaml` to already contain an `mcp_servers` key — which a fresh install doesn't have — so `/mcp` returned an unavailable payload even when the dashboard was running. Chicken-and-egg: you couldn't add a server because the key was missing, and the key was missing because no server was ever added. `probeMcpConfigKey()` now gates on config _reachability_ (not key presence); the write path already creates `mcp_servers` on first add, and the `isLocalhostDeployment()` safety gate is kept.
- **File Manager blank on fresh installs.** When no real workspace is selected (or the throwaway auto-created `~/workspace` default), `/files` now shows a first-run "Choose your workspace folder" picker instead of an empty view. It reuses the existing `POST /api/workspace` mechanism (shared with the chat composer), surfaces known workspaces as quick-picks, and loads the chosen folder immediately.

## [2.3.23] — 2026-06-05

Visual bug-report widget.

### Added

- **Userback feedback widget.** Any user can file a bug report with a screenshot/annotation from inside Switch UI. On by default; override your token or disable via `VITE_USERBACK_TOKEN` (`=off` to disable). CSP `script-src`/`style-src`/`font-src` widened to allow `static.userback.io`.

## [2.3.22] — 2026-06-05

Dashboard banner bugfix + dynamic detection.

### Fixed

- **False "Limited mode" banner.** The dashboard-unavailable banner read `capabilities.dashboard` (a nested `{ available }` object) as if it were a boolean, so the check was always false and the banner showed permanently whenever the gateway was up — even with the dashboard connected. It now reads `capabilities.dashboard?.available`.
- **Dynamic recovery.** The banner polls every 15s (was 60s) with refetch-on-focus, and the server probe TTL now treats gateway-up/dashboard-down as a partial state (15s re-probe instead of 120s), so the banner clears within ~15s of starting the dashboard. The per-session dismissal is auto-cleared when the dashboard recovers.

### Changed

- **react-grab** dev overlay is gated to the dev server only (stripped from production builds) and can be opted out in dev with `VITE_REACT_GRAB=0`.

## [2.3.21] — 2026-06-05

Config single-source + dashboard awareness.

### Fixed

- **`.env` is now the single source of truth for gateway/dashboard URLs.** Removed the `~/.hermes/workspace-overrides.json` layer — an upstream-Workspace remnant that silently outranked `.env` with no reachability check, so a stale override (e.g. carried over from another machine) sent every gateway+dashboard call to the wrong host on an otherwise-correct local install. URL resolution is now `HERMES_API_URL`/`CLAUDE_API_URL` → default only.
- **Auto-clean stale overrides.** On startup, any existing `workspace-overrides.json` is renamed to `.bak` with a one-line notice.

### Added

- **Dashboard-availability warning (installer).** `install.sh` now probes the gateway (:8642) and dashboard (:9119) at the end of install and prints a loud warning when the dashboard isn't running — sessions/skills/memory/kanban/jobs depend on it. The two-backend model is spelled out in the banner.
- **Dashboard-availability warning (UI).** A persistent "Limited mode — Hermes dashboard not connected" banner appears when the gateway is reachable but the dashboard (port 9119) is not, with the `hermes dashboard --no-open --skip-build` start command.

### Changed

- Settings → Connection now persists URL changes to the project `.env` (instant in-process update, survives restart) instead of the removed JSON file.
- README: new "Two backends: gateway + dashboard" section + dashboard-as-service guidance.

## [2.3.20] — 2026-06-05

Install-flow hardening.

### Fixed

- **Safe installer re-runs.** `install.sh` no longer aborts on re-run when the working tree is dirty (users edit `.env` in place) — it skips the pull with a note, and catches a diverged fast-forward instead of dying under `set -euo pipefail`.
- **Port preflight.** New `scripts/check-ports.mjs` runs as `prestart:all` and fails fast with an actionable message (naming `GATEWAY_PORT` / `PORT`) when 8642 or 3000 is already bound, instead of `concurrently` silently swallowing the gateway bind failure.
- **Actionable connection-check.** The onboarding connection step now distinguishes "gateway not running" vs "HTTP API disabled (`API_SERVER_ENABLED`)" vs reachable-but-unusable, each with its own fix hint.
- **Provider gate.** The onboarding model step blocks completion when no provider/model is configured, so users can't click through into a dead chat. Externally-managed backends still pass.
- **Restart hint.** After enabling `API_SERVER_ENABLED=true`, `install.sh` warns to `hermes gateway restart` if a gateway is already running.

### Changed

- The "install for full features" hint in `gateway-capabilities.ts` now points at the Interstellar-code fork installer.

## [2.3.19] — 2026-06-05

Install & onboarding polish.

### Changed

- **install.sh now installs the Interstellar-code fork of `hermes-agent`** instead of the NousResearch upstream installer. Friendlier per-OS prereq hints and a clearer final banner.
- **Background-service guidance.** The installer banner and README now document `hermes gateway install` (systemd on Linux / launchd on macOS) for always-on setups, plus `pnpm dev`-only afterward, with a WSL "no systemd by default" caveat.
- **Onboarding honesty.** After saving a provider/API key, the wizard and the `/api/claude-config` PATCH response now state that the gateway reads config at startup only — restart (`hermes gateway restart` / `pnpm start:all`) for changes to take effect.
- **README install section** rewritten: three paths (one-liner / manual / Docker), prerequisites, security note, and a new "Run as a background service" subsection. Stale NousResearch install URLs swapped to the Interstellar-code fork.

## [2.3.11] — 2026-05-23

Cleanup release. Closes 9 open issues from the in-repo code review.

### Fixed

- **#37 — files-screen rename/mkdir silent failures.** `handlePromptSubmit` now checks `res.ok` on the rename and mkdir POSTs and renders the error inline in the prompt dialog. The tree only reloads on success.
- **#43 — agent-version cache backward-clock skew.** Added a `now >= cached.ts` prerequisite so a backward NTP/sleep jump no longer pins the cached value indefinitely.

### Performance

- **#38 — nav boardsQuery skipped when collapsed.** `useBoards` accepts an `enabled` flag; PrimaryNavV2 passes `!collapsed` so the badge query stops firing when the badge isn't visible.
- **#39 — files-screen tree filter debounced.** Added a 150ms debounced copy of `treeQuery`; the recursive `visibleEntries` walk is now keyed on the debounced value while the input + visual hints stay snappy.
- **#40 — profiles-browser memoization.** `listProfiles()` now caches results for 5 seconds; every mutating function (`createProfile`/`deleteProfile`/`updateProfileConfig`/`renameProfile`/`setActiveProfile`) invalidates the cache so the UI sees changes immediately. The dev-mode `console.warn` in `setActiveProfile` is gated behind `NODE_ENV !== 'production'`.
- **#41 — /api/models parses config.yaml once per request.** Introduced `readConfigOnce()`; `readProvidersFromConfig`, `readClaudeDefaultModel`, `readModelAliasesFromConfig`, and `readStreamTimeouts` now accept the parsed config as a parameter instead of each reopening the file.
- **#46 — mcp hubQuery skipped outside Market tab.** `useMcpHub` accepts an `enabled` flag; McpScreen passes `statusFilter === 'market'` so the marketplace fetch only fires when the Market tab is showing.

### Refactor

- **#45 — utility consolidation.** Extracted formatters to `src/lib/format.ts` (`formatBytes`, `formatDate`, `formatRelative`) and POSIX path helpers to `src/lib/path-utils.ts` (`getExt`, `getParentPath`). files-screen and profile-card now import from the shared modules.

### Polish

- **#44 — vite.config dev-server boot.** Sanitized the workspace-daemon stale-port cleanup before shell interpolation, moved `workspaceDaemonStarted = true` to after a successful spawn (try/catch keeps state correct on failure), and replaced the fixed 15 × 1s health-check polling loop with a bounded backoff schedule so a ready agent returns sooner.

## [2.3.10] — 2026-05-22

Patch release. Profile picker no longer duplicates the gateway's active named profile with a synthetic `default` card.

### Fixed

- **Synthetic `default` profile suppressed when a named profile is active** — `src/server/profiles-browser.ts` always injected a synthetic `default` card built from `~/.hermes/config.yaml`, even when a named profile (e.g. `hermes-switch`) was selected. Both cards then represented the same gateway runtime, which was confusing and caused tier/status mismatches (`default` always showed T3 because the root config has no `agent_ui:` block). The synthetic card now appears only when `~/.hermes/active_profile` is empty or set to `default` — i.e. when there genuinely is no named profile in use.

## [2.3.9] — 2026-05-22

Patch release. Profile picker now distinguishes the currently-selected ("in use") profile from the agent_ui.status presentational label, and the sidebar version chip auto-refreshes on `pnpm version` bumps without a manual dev-server restart.

### Added

- **`IN USE` badge on the currently-selected profile card** — the gateway's active profile (the one resolved from `~/.hermes/profiles/.active`) now shows an explicit `⚡ IN USE` badge plus a green-glow border. Distinct from each profile's `agent_ui.status: active | idle` label, which is purely presentational metadata set per-profile and was previously colliding semantically with the selection state. Built-in profiles (Neo, Trinity, Morpheus) still show ACTIVE from `agent_ui.status`, but the `default` profile — usually the gateway's actual selection — now correctly surfaces as `IN USE` even though its `agent_ui` block is unset.
- **Dev-server auto-restart on `package.json` change** — Vite plugin `restart-on-package-json` watches the project's `package.json` and calls `server.restart()` whenever the version (or any other field) changes. Without this, `__APP_VERSION__` (computed once at config load via `define`) stays stale after `pnpm version` bumps and the sidebar version chip lies.

## [2.3.8] — 2026-05-22

Patch release. Fixes upload landing at workspace root (issue #34).

### Fixed

- **Files upload honors selected folder (#34)** — the header UPLOAD button hardcoded `''` as the target path, so every upload landed at the workspace root regardless of which folder was selected in the tree. The button now derives the target from `selectedEntry`: a selected folder uploads there, a selected file uploads to its parent, nothing selected falls back to the workspace root. Tooltip updates to reflect the resolved target.

## [2.3.7] — 2026-05-22

Patch release. The workflows page Backend toggle is no longer cosmetic — `native` and `plugin` now actually return different content, and workflows created by hermes-agent via the plugin API appear in the UI without restart.

### Fixed

- **Backend toggle was cosmetic** — `GET /api/workflow-definitions` ignored the `X-Workflow-Backend` header that the workflows page sent, so every fetch went to the native engine regardless of the dropdown selection. The route now resolves the engine via `factory.getEngine(request)`, so `plugin` requests reach the hermes-agent dashboard plugin via the existing `/api/dashboard-proxy/...` splat and `native` requests stay on the local SwitchUiWorkflowStore.

### Notes

- Native dev store (`~/.hermes/dev/...switchui-workflows.db`) and plugin canonical store (`~/.hermes/switchui-workflows.db`) are still separate databases. After this fix the toggle exposes that split honestly — plugin mode shows the full plugin catalog including workflows authored by hermes-agent itself; native mode shows only the dev-process bundled defaults plus any locally-authored entries.
- A separate hermes-agent migration (uncommitted in `~/.hermes/hermes-agent/plugins/workflow-engine/defaults/`) seeded 22 workflows into the plugin catalog so it is now a proper superset of the SwitchUI bundled defaults. Custom workflows from the slot-a worktree (`gateway-health-check`, `pr-review-5agents`) are preserved there. Those YAMLs ship with hermes-agent, not SwitchUI, and are not part of this release.

## [2.3.6] — 2026-05-22

Patch release. MCP detail drawer fully wired, sidebar shows live agent + Switch UI versions, session naming retries on follow-up turns, stale-session deletes no longer error out. Repo also detached from the upstream fork (Settings → Leave fork network); homepage updated to `hermes-switchui.zi0n.space`. No breaking code changes.

### Added

- **Live version footer in primary nav** — replaces hard-coded `v2.3.0` label with `HERMES (<agent-version>)` + `Switchui (<package-version>)`. Agent version pulled from a new `/api/agent-version` route (proxies dashboard `/api/status`, 60s server-side cache). Package version injected at build via Vite `define: { __APP_VERSION__ }`.
- **`src/routes/api/agent-version.ts`** — server-only route exposing the hermes-agent gateway version.
- **`src/vite-env.d.ts`** — declares `__APP_VERSION__` global for TS.
- **MCP picker surfaces `model_aliases:`** — `/api/models` now merges `model_aliases:` entries from `~/.hermes/config.yaml` into the picker, so user-defined aliases (e.g. `manifest`, `premium`) appear as selectable model entries.

### Fixed

- **MCP detail drawer quick actions wired** — `Test connection`, `Discover tools`, `Disconnect` now actually call `/api/mcp/test`, `/api/mcp/discover`, and DELETE `/api/mcp/$name`. Previously all four buttons had no `onClick` (only `Copy endpoint` worked). `Restart` removed — depended on a runtime endpoint the gateway doesn't expose. Disabled MCP servers (`enabled: false`) now correctly render as `disabled` instead of incorrectly showing `connected`/`online`.
- **Sidebar context menu Delete actually fires** — outside-click handler was unmounting the entire menu (including the confirmation dialog) before the dialog's `onClick` could run, because `InlineDeleteDialog` is a sibling of `menuRef`, not inside it. Handler now short-circuits while a dialog is open.
- **Session delete no longer hard-errors on 404** — `useDeleteSession` treats a 404 from the hermes-agent dashboard as already-deleted so stale UI rows can be cleared without a toast.
- **Session title retries on follow-up turns** — `useAutoSessionTitle` signature now includes `messages.length`, so a first-turn LLM failure no longer locks the session at "untitled" forever. Each new turn re-attempts; once the title settles to a non-generic value, retries stop.
- **Silent title-PATCH failures are now visible** — `onError` surfaces a toast (`Session title update failed: …`) and the sidebar label shows `Untitled (title error)` instead of the misleading `New Session`.

## [2.3.5] — 2026-05-09

Single-system chat UI. Strips the v1 chat surface so the v2 unified sessions sidebar / matrix-themed chat surface is the only path. The `VITE_HERMES_SIDEBAR_V2` feature flag is gone — install / onboarding no longer require any env-var gymnastics to get the Switch UI.

### Removed

- **v1 chat UI components** (7 files, ~2451 lines): `src/screens/chat/components/chat-sidebar.tsx`, `chat-header.tsx`, `sidebar/sidebar-sessions.tsx`, `sidebar/session-item.tsx`, `sidebar/session-rename-dialog.tsx`, `sidebar/session-delete-dialog.tsx`, `sidebar/v2/sidebar-flag.ts`
- **`VITE_HERMES_SIDEBAR_V2`** env flag from `.env.example`
- **All 8 conditional branch sites** in `chat-screen.tsx` + `workspace-shell.tsx` collapsed to v2-only path; the `useSidebarV2Flag` hook removed entirely

### Changed

- `sidebar-card-context-menu-v2.tsx` absorbs rename + delete dialogs (previously imported from deleted v1 files) as inline components, wired to `useRenameSession` / `useDeleteSession` with proper loading + error UX (Save/Delete buttons disable during in-flight, error rendered inline, Esc/Cancel blocked while saving). Codex review caught a no-op rename on the first pass — fixed in this release.
- `AGENTS.md`: noted the v1 strip in the chat UI section

### Mobile

No code changes needed — pre-deletion audit (`.omc/v1-audit.md`) confirmed `mobile-tab-bar.tsx` and `mobile-hamburger-menu.tsx` had zero v1 chat-component imports. Mobile surfaces continue to work with the v2 sidebar/header path that was already shipped.

## [2.3.4] — 2026-05-08

First release as **Switch UI** — fork of `outsourc-e/hermes-workspace` with a Matrix-styled UI direction. Bundles the v2.3.0 upstream bugfixes plus the Switch UI typography pass, unified sessions sidebar, composer retheme, and HermesWorld removal.

### Added

- **Switch UI rebrand** — README rewritten to reflect fork identity; credits upstream and documents sync strategy (cherry-pick backend/infra only)
- **Matrix design system** — ported mockup tokens into `src/styles.css`; reusable utility classes `.m-mono`, `.m-label`, `.m-chip`, `.m-timestamp`, `.m-body`, `.m-glow-text`; aliased the previously-undefined `--font-mono` so JetBrains Mono actually loads
- **Unified sessions sidebar (v2)** — single feed across chat / cron / api / task sources, day-grouped (Pinned / Today / Yesterday / Earlier), source filter chips, state segments, free-text search, persisted collapse
- **Composer Matrix retheme** — workspace, model, profile, and thinking-level popovers all use green-glow border + neon shadow + mono uppercase items; outer wrapper made transparent (no more backdrop-blur over narrow-viewport icons)
- **Chat meta bar wiring** — live indicator + tok/s, model, ctx %, tool count, profile, session id; profile via `/api/profiles/list`, tok/s derived from `usedTokens` deltas, tool count from merged ToolTabView extraction, model fallback from `activeSession.model`
- **Files panel toggle** in chat header — replaces the sessions panel slot when active
- **Inline-path file links** in chat messages — clicking a path opens the files panel in place
- **Activity card** matches mockup: `[ACTIVITY · N TOOLS]` header, per-row file/size/duration tail, emoji icons next to tool names
- **TASK source chip** — filters chats triggered from kanban tasks
- **Settings modal** in primary nav
- **Sidebar polish** — Hermes avatar persists in collapsed nav; expand chevron in rail + collapsed nav body; primary-nav and sessions-shell wrapped in matching rounded-border cards

### Changed

- **Sessions cap 50 → 1000** on `GET /api/sessions` so the unified feed can render full session history
- **Sessions filter store migrated to v4** — drops today-only date default and chat-only source default; cleanly migrates v2/v3 state
- **Theme list** — Matrix is the default; full set: Matrix, Claude Nous, Claude Official, Claude Classic, Claude Slate
- **Manifest provider** — Switch UI uses a named `manifest` provider entry (not `custom`, which is reserved by the gateway)

### Removed

- **HermesWorld / Playground 3D game feature** — 50 files, ~13.8k lines (full `src/screens/playground/**`, `playground-ws-worker/` Cloudflare Worker package, route entries, env vars, docs, memory iteration notes). Doesn't fit Switch UI's productivity direction.

### Fixed (cherry-picks from upstream v2.3.0)

- `fix(chat)`: preserve workspace session identity during streams (#310)
- `fix(chat)`: correct local session accounting and titles (#350)
- `fix(jobs)`: render structured error bodies as readable text instead of `[object Object]` (#304)
- `fix(gateway)`: faster recovery from disconnected state + docker docs (#275)
- `fix(context)`: add `kimi-k2.6` 256k context window support (#357)
- `fix(updates)`: show "Hermes updated" modal only once per release (#386)
- `fix(docker)`: start Hermes Agent gateway in compose (#385)
- `fix(terminal)`: keep PTY alive across SSE disconnects + auto-reattach (#298)
- `fix(conductor)`: fall back when dashboard mission api is unavailable (#317)
- `fix(conductor)`: sanitize mission goals before spawn (#335)
- `fix`: bridge Codex OAuth tokens to portable-mode chat bearer auth (#332)
- `fix`: harden workspace swarm prompt submission (#307)
- `fix`: preserve tmux startup failures for swarm workers (#341)
- `fix`: allow workspace production server to start (#308)

### Build

- `package.json`: declare `pnpm.onlyBuiltDependencies` allowlist (`electron`, `electron-winstaller`, `esbuild`, `unrs-resolver`) so pnpm 10+ install no longer fails on `ERR_PNPM_IGNORED_BUILDS` in Docker CI

## [Unreleased pre-fork]

### Changed

- **`docker compose up` now pulls pre-built images by default** (#82) — `nousresearch/hermes-agent:latest` for the gateway and `ghcr.io/outsourc-e/hermes-workspace:latest` for the UI. Agent state persists in the `claude-data` named volume. Adds `docker-compose.dev.yml` overlay for building from source.

## [2.0.0] — 2026-04-20

**Zero-fork release.** Clone, don't fork. Hermes Switch UI now runs on vanilla `pip install hermes-agent` with no patches, no drift, no custom gateway required.

### Added

- **Zero-fork architecture** — dual gateway/dashboard routing; workspace talks directly to vanilla `hermes-agent` 0.10.0+ via standard endpoints (`/v1/models`, `/api/sessions`, `/api/skills`, `/api/config`, `/api/jobs`)
- **One-liner curl installer** — `curl -fsSL … | bash` provisions workspace + gateway + defaults
- **Claude-Nous theme** — dark + light editorial variants with cobalt/paper surface pass, thin 1px architectural borders, editorial type accents
- **Conductor** (`/conductor`) — mission-control surface ported from Clawsuite; spawn missions, assign workers, watch live output and costs
- **Operations** (`/operations`) — agent registry / sessions manager ported from Clawsuite; pause, steer, kill live agents with role and model insight
- **Synthesized tool pills** — inline tool-call rendering from dashboard stream markers when running against zero-fork gateway
- **Landing parity pass** — hero, features, screenshots, setup, OG image, mobile theme toggle
- **Task board status vs. assignee** decoupling
- **Local-model chat session persistence** — local sessions appear in history + session list
- **Memory is local-fs first** — honors `HERMES_HOME`, no gateway dependency
- **Splash + screenshots refresh** — Conductor, Dashboard, Tasks, Jobs captured in new editorial theme

### Changed

- **Model picker** — fetches from gateway (`~/.hermes/models.json` for user-configured models), matches OCPlatform behavior; shows only configured providers instead of all upstream
- **`enhanced-fork` mode label** no longer implies a fork is required; it indicates streaming route availability on vanilla gateway
- **Dashboard + enhanced-chat capabilities** marked optional; missing endpoints no longer trigger warnings
- **Feature-gate + install copy** — all fork-era references purged
- **Theme family allowlist** — `claude-nous` promoted to the enterprise allowlist
- **Session pill** — solid dark-mode background, matches model selector

### Fixed

- Duplicate responses and disappearing history on interrupt (#62)
- Portable-mode double user message, uncleaned timeouts, orphaned unregister callbacks
- Local model selection actually propagates to chat (no silent fallback)
- Strip provider prefix correctly for local routing
- Dashboard token injection on `/` (not `/index.html`)
- Onboarding no longer stacks behind workspace shell
- Root bootstrap guards against uncaught errors
- Preserve assistant text during tool-call streaming
- Installer output uses defined escape vars (removed undefined BOLD/RESET)

### Removed

- All references to the legacy "enhanced fork" as a requirement
- Stale fork-era gateway instructions and feature-gate copy

---

## [1.0.0] — 2026-04-10

Initial public release. Chat, files, memory, skills, terminal, dashboard, settings — the foundational workspace.
