# Mir4Local Admin

Private tool for entering content that appears in the public Mir4Local app.
It is NOT part of the public installer. Keep it on your own computer.

## One-time setup
1. Install Node.js (LTS) if you don't have it.
2. In this `admin` folder run:
   ```
   npm install
   npm start
   ```
3. Create a GitHub token:
   GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token.
   - Repository access: Only select repositories > your repo.
   - Permissions > Repository permissions > Contents: Read and write.
   - Set an expiry you are comfortable with and copy the token.
4. In the admin app open Settings, check owner / repo / branch, paste the token, and save.
   The token is stored encrypted on this computer only.

## Daily use
- Add or edit missions, then select Publish.
- Publish commits `data/missions.json` to your repo. The public app reads that file, so no new app release is needed.
- Changes are saved locally as you work. Pull from GitHub loads the published version (useful on a new computer).

## Optional: a double-click admin app
`npm run dist` builds a portable `.exe` in `admin/dist`. Keep it private; do not upload it to a public release.
If Windows reports a symbolic link error, turn on Developer Mode in Windows settings and run it again.
