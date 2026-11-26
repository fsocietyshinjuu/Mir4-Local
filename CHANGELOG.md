# Changelog

All notable changes to Mir4Local. The newest version is first.

## 1.4.0

### Added

- **World Boss, Events, Crafting and Mystery tabs** with translated boss, map, area and location names, schedules, countdowns, summon badges, scroll lists and tutorial links.
- **Home dashboard** now shows upcoming world bosses and events and a weekly completion message instead of falling back to unfavorite bosses.
- **Per-field translations** for published boss, mission, map, area and location names in all 12 languages.
- **Admin CRUD** for every new section, with schedule editors, multiple event areas, multiple Mystery scrolls, per-field translation editors and auto-translate.
- **Badge image uploads** in Admin → Crafting: images are resized to at most 256×256 WebP, published to `data/assets/badges/` and deleted when replaced or removed.
- **Publish previews**, validation, automatic backups of the last 10 published versions and one-click rollback.
- **Data load status** in the public app: validated data, ETag rechecks, retries, a Retry button, cached/bundled fallback and a visible status message.
- **Reminder reliability**: deduplication across restarts, resync when the tab becomes active and an in-app toast fallback when notifications are blocked.
- **Landing page** now highlights the new World Boss, Events, Crafting, Mystery and reliability features in all 12 languages.

### Changed

- Updated the README, CHANGELOG and RELEASE_NOTES for the new feature set.
- GitHub Pages deployment now builds the site in a separate job from the deploy step.

### Fixed

- `24:00` spawn countdowns landing on the previous day.
- GitHub Pages deployment failing with "Fetching artifact metadata failed" and "No artifacts named github-pages were found": added the `actions: read` permission, an explicit `github-pages` artifact name and disabled in-progress cancellation.

## 1.0.0

First release.

- Live boss spawn countdowns with spawning-soon and spawned highlights.
- Home dashboard.
- Toast and sound reminders, with tray mode.
- Characters with their own favorites and progress.
- Dropdown filters, search, favorites, hide done.
- Random-spawn and respawn-after-kill bosses.
- 12 languages, light and dark themes.
- Desktop app (Windows, macOS, Linux) with automatic updates, and a web app.
- Private admin app for publishing mission data.
