const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const FILE_PATH = 'data/missions.json';

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    title: 'Mir4Local Admin',
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

/* ---------- Local files (draft + settings) ---------- */
const draftFile = () => path.join(app.getPath('userData'), 'missions-draft.json');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function getSettings() {
  const s = readJson(settingsFile(), {});
  let token = '';
  if (s.token && safeStorage.isEncryptionAvailable()) {
    try { token = safeStorage.decryptString(Buffer.from(s.token, 'base64')); } catch {}
  }
  return {
    owner: s.owner || 'fsocietyshinjuu',
    repo: s.repo || 'Mir4-Local',
    branch: s.branch || 'main',
    token,
  };
}

const publicSettings = (s) => ({ owner: s.owner, repo: s.repo, branch: s.branch, hasToken: !!s.token });

ipcMain.handle('admin:init', () => ({
  draft: readJson(draftFile(), null),
  settings: publicSettings(getSettings()),
}));

ipcMain.handle('draft:save', (_e, draft) => {
  fs.writeFileSync(draftFile(), JSON.stringify(draft));
  return true;
});

ipcMain.handle('settings:save', (_e, next) => {
  const current = readJson(settingsFile(), {});
  const out = {
    owner: String(next.owner || '').trim(),
    repo: String(next.repo || '').trim(),
    branch: String(next.branch || '').trim() || 'main',
    token: current.token || '',
  };
  const newToken = String(next.token || '').trim();
  if (newToken) {
    if (!safeStorage.isEncryptionAvailable()) {
      return { ok: false, error: "This computer can't encrypt the token, so it was not saved." };
    }
    out.token = safeStorage.encryptString(newToken).toString('base64');
  }
  fs.writeFileSync(settingsFile(), JSON.stringify(out));
  return { ok: true, settings: publicSettings(getSettings()) };
});

/* ---------- GitHub ---------- */
const ghUrl = (s) => `https://api.github.com/repos/${s.owner}/${s.repo}/contents/${FILE_PATH}`;
const ghHeaders = (s) => ({
  Authorization: `Bearer ${s.token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'Mir4Local-Admin',
});

async function ghError(res) {
  let msg = '';
  try { msg = (await res.json()).message || ''; } catch {}
  if (res.status === 401) return 'GitHub rejected the token. Check it in Settings (it may have expired).';
  if (res.status === 403 || res.status === 404) {
    return `GitHub said "${msg || res.status}". Check the owner, repo and branch in Settings, and that the token has Contents read and write access to this repo.`;
  }
  if (res.status === 409 || res.status === 422) return `GitHub said "${msg}". Pull the latest data, then publish again.`;
  return `GitHub error ${res.status}${msg ? `: ${msg}` : ''}`;
}

async function ghGet(s) {
  const res = await fetch(`${ghUrl(s)}?ref=${encodeURIComponent(s.branch)}`, {
    headers: ghHeaders(s),
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) {
    // 404 can mean "file not created yet" or "wrong repo/no access". Check the repo itself.
    const repoRes = await fetch(`https://api.github.com/repos/${s.owner}/${s.repo}`, { headers: ghHeaders(s) });
    if (!repoRes.ok) throw new Error(await ghError(res));
    return null;
  }
  if (!res.ok) throw new Error(await ghError(res));
  const j = await res.json();
  return { sha: j.sha, data: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')) };
}

ipcMain.handle('github:pull', async () => {
  const s = getSettings();
  if (!s.token) return { ok: false, error: 'Add your GitHub token in Settings first.' };
  try {
    const existing = await ghGet(s);
    return { ok: true, data: existing ? existing.data : null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('github:publish', async (_e, data) => {
  const s = getSettings();
  if (!s.token) return { ok: false, error: 'Add your GitHub token in Settings first.' };
  try {
    const updatedAt = new Date().toISOString();
    const out = { ...data, updatedAt };
    const existing = await ghGet(s);
    const body = {
      message: `Update missions (${updatedAt})`,
      content: Buffer.from(JSON.stringify(out, null, 2) + '\n').toString('base64'),
      branch: s.branch,
    };
    if (existing) body.sha = existing.sha;

    const res = await fetch(ghUrl(s), {
      method: 'PUT',
      headers: { ...ghHeaders(s), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(await ghError(res));
    return { ok: true, updatedAt };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
