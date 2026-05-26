# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.3.0] - 2026-05-26

### Added
- **Welcome Docs Page**: Introduced a gorgeous dedicated documentation welcome page at `/docs/welcome` featuring full copy, categorized core features, extended capacities lists, and structured layout panels.
- **TopNav Integration**: Added a direct highlighted menu link pointing to the new Docs portal inside `TopNav.astro`.
- **Interactive UI Mockup**: Designed and coded a pure CSS/HTML mockup representing the *Hermes Switch UI Home Page in Matrix-Dark Theme* to replace static/missing screenshot placeholders. Includes active pulse animations, sidebar panels, input console, and a simulated streaming chat.
- **Project Packaging**: Pre-packaged the static production compilation into a zip file (`website_build.zip`) for easy deploy to Apache Virtualmin webservers.

### Changed
- **Main Landing Page Refactoring**: Directly integrated the welcome documentation copy into the main landing page (`index.astro`), updating the Hero titles, adding a side-by-side "Paired Processes" section, and aligning all description cards.
- **Visual Polish**: Disabled CPU-heavy canvas shadow-blurs and title glitch shifting on the matrix rain hero canvas inside `HeroRain.astro`, ensuring 100% smooth, flicker-free rendering on high-refresh-rate devices.

---

[2.3.0]: https://github.com/nousresearch/hermes-agent/compare/v2.2.0...v2.3.0
