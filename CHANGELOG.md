# Changelog

All notable changes to Mir4Local. The newest version is first.

## Unreleased

- Added World Boss, Events, Crafting and Mystery tabs with translated content.
- Home now shows upcoming world bosses/events and a weekly completion message instead of falling back to unfavorite bosses.
- Published boss, mission, map, area and location names now support translations in all 12 languages.
- Admin gained full CRUD for the new sections, schedule editors, auto-translation and an updated dashboard.
- Crafting badge images are now uploaded by the admin and published as small WebP assets instead of pasted URLs.
- Added publish previews, data validation, automatic backups and one-click rollback in the admin app.
- Public app now validates published data, retries with ETag checks, falls back to cached/bundled data and shows its load status.
- Reminders are deduplicated across restarts, resync when a tab becomes active and fall back to an in-app toast when notifications are blocked.
- Fixed `24:00` spawn countdowns landing on the previous day.
- Fixed GitHub Pages deployment by granting artifact-read permission and naming the Pages artifact explicitly.

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
