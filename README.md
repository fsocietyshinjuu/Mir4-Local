# Mir4Local

Two apps in one repository:

- **Public app** (repo root): the installer users download. Shows the Mission Tracker and updates itself from GitHub Releases.
- **Admin app** (`admin/`): private tool for entering content. It is never built or released by GitHub Actions.

## How content reaches users
1. You enter data in the admin app and select Publish.
2. Admin commits `data/missions.json` to this repo.
3. The public app downloads that file on launch, on Refresh data, and every 15 minutes. It keeps a copy for offline use.

Content changes need no new release. Only code changes (anything in `main.js`, `preload.js`, `renderer/`) need a version bump and a tag.

## Releasing a public app update
1. Bump `version` in `package.json`.
2. Create a GitHub release with the matching tag (for example `v1.1.0`). Actions builds and attaches the installers.

## Admin app
See `admin/README.md`.
