# Mir4Local v1.1.0

A bigger update: four new sections to track, translated names everywhere, and a much more reliable data and reminder system.

> [!NOTE]
> v1.0.0 was the first release. This is the first feature update after it.

## ✨ Highlights

- **Four new tabs**
  - 🐉 **World Boss** — weekly schedules with boss, map, area, location and countdowns.
  - 🎪 **Events** — schedules with multiple maps, areas and locations.
  - 🛠️ **Crafting** — summon badges with images, crafting NPCs and summon locations.
  - 📜 **Mystery** — scroll lists and tutorial links.
- **Home, improved** — upcoming world bosses and events at a glance, plus a celebration when your weekly missions are all done.
- **Your language, everywhere** — published boss, mission, map, area and location names are translated in all 12 languages, alongside the full UI.
- **Safer publishing** — the private admin app now previews changes, validates data, keeps backups and can roll back with one click. Badge images are uploaded and optimized automatically.
- **More reliable data** — validated on load, retried with ETag checks, cached and backed by a bundled offline snapshot. A clear status shows what happened and a Retry button is there when you need it.
- **Reminders you can trust** — no duplicates after a restart, recalculated when you come back to the tab, and an in-app toast if browser notifications are blocked.
- **Fixes** — `24:00` countdowns now land on the correct day, and the website deploys cleanly again.

## ⬆️ Upgrading from v1.0.0

Install the new version normally over the old one. Your characters, favorites, progress and settings are kept. New content is downloaded from GitHub, so there is nothing else to configure.

If you were on an early test build, uninstall it first, then install this release.

## 📌 Good to know

- **New sections start empty until content is published.** The public app shows them with an empty state; the admin app is where bosses, events, recipes and mysteries are added.
- **After a publish, data can take about 5 minutes to appear** because of GitHub's CDN cache. The app checks for updates every 15 minutes; click **Refresh** in Settings to check sooner.
- Toasts do not appear over games in exclusive fullscreen. Use windowed or borderless fullscreen.
- The app must be running for reminders to work. It can stay minimized or live in the tray.
- Random and respawn bosses show a label only. They have no countdown or reminders.
- On Windows, SmartScreen may warn the first time because the app is not code-signed: choose **More info → Run anyway**.

## ⬇️ Downloads

| Platform | File |
|---|---|
| Windows | Installer (`.exe`) |
| macOS | Disk image (`.dmg`) |
| Linux | `.AppImage` |
| Browser | [Open the web app](https://fsocietyshinjuu.github.io/Mir4-Local/app/) |

Installed copies update themselves from here on. See the [changelog](CHANGELOG.md) for the full list of changes.
