# My Desktop App

Plain HTML/CSS/JS app wrapped in Electron. Packaged builds check GitHub Releases for updates.

## Setup
1. In `package.json`, set `build.publish.owner` and `build.publish.repo` to your GitHub user and repo.
2. Change `build.appId`, `productName`, and `author`.
3. `npm install`
4. `npm start` to run in development (update checks are off here).

## Build an installer locally
`npm run dist` creates installers in `dist/`.

## Release an update
1. Edit your code in `renderer/`.
2. Bump `version` in `package.json` (for example 1.0.0 to 1.0.1).
3. Commit, then:
   ```
   git tag v1.0.1
   git push && git push --tags
   ```
4. GitHub Actions builds Windows, macOS and Linux installers and publishes them to a GitHub Release.
5. Installed copies of the app find the new release on next launch, download it, and show a "Restart and install" button.

## Notes
- The tag version must match `package.json` version, and versions must increase.
- The release must be published (not a draft) for updates to be found.
- macOS auto-update needs code signing and notarization (Apple Developer account). Without it the macOS build installs but will not auto-update.
- Windows works unsigned but shows a SmartScreen warning on first install.
- Use a public repo. Private repos would require shipping a token inside the app.
