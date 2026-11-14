const { app, BrowserWindow, ipcMain, Notification, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

// Where the public app reads its content. Keep in sync with package.json "publish".
const GITHUB_OWNER = 'fsocietyshinjuu';
const GITHUB_REPO = 'Mir4-Local';
const DATA_BRANCH = 'main';
const MISSIONS_URL =
  `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${DATA_BRANCH}/data/missions.json`;

let win;
const liveNotes = new Set(); // keeps notifications alive until they close

// Lets Windows attribute notifications to this app (matches the installer's appId).
try {
  const appId = require('./package.json').build?.appId;
  if (appId && process.platform === 'win32') app.setAppUserModelId(appId);
} catch {}

function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 700,
    minWidth: 760,
    minHeight: 480,
    title: 'Mir4Local',
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,                // keep reminders on time while minimized
      autoplayPolicy: 'no-user-gesture-required', // allow reminder sounds
    },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });

  // Links (for example the developer email) open in the user's browser or mail app, never inside the app.
  const openOutside = (url) => { if (/^(https:|mailto:)/i.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { openOutside(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); openOutside(url); } });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/* ---------- Content data (fetched from GitHub, cached for offline use) ---------- */

const cacheFile = () => path.join(app.getPath('userData'), 'missions-cache.json');

ipcMain.handle('missions:load', async () => {
  try {
    // The timestamp keeps GitHub's CDN from handing back an old copy.
    const res = await fetch(`${MISSIONS_URL}?t=${Date.now()}`, {
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    if (res.status === 404) return { ok: true, source: 'empty', data: { missions: [] } };
    if (!res.ok) throw new Error(`Server replied ${res.status}`);
    const data = await res.json();
    try { fs.writeFileSync(cacheFile(), JSON.stringify(data)); } catch {}
    return { ok: true, source: 'online', data };
  } catch (err) {
    try {
      const data = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
      return { ok: true, source: 'cache', data, error: err.message };
    } catch {
      return { ok: false, error: err.message };
    }
  }
});

/* ---------- App auto-update ---------- */

function setupAutoUpdate() {
  if (!app.isPackaged) {
    send('update:status', { state: 'dev', message: 'Update checks are disabled in development.' });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () =>
    send('update:status', { state: 'checking', message: 'Checking for updates…' }));
  autoUpdater.on('update-available', (info) =>
    send('update:status', { state: 'available', version: info.version, message: `Version ${info.version} found. Downloading…` }));
  autoUpdater.on('update-not-available', () =>
    send('update:status', { state: 'current', message: 'You are on the latest version.' }));
  autoUpdater.on('download-progress', (p) =>
    send('update:status', { state: 'downloading', percent: Math.round(p.percent), message: 'Downloading update…' }));
  autoUpdater.on('update-downloaded', (info) =>
    send('update:status', { state: 'ready', version: info.version, message: `Version ${info.version} is ready to install.` }));
  autoUpdater.on('error', (err) => {
    const raw = String((err && err.message) || err);
    // A release that is published but still uploading has no latest.yml yet. Not a real failure.
    const noFiles = /latest(-mac|-linux)?\.yml/i.test(raw) && /404|cannot find/i.test(raw);
    const short = raw.split('\n')[0].slice(0, 160);
    send('update:status', { state: 'error', code: noFiles ? 'nofiles' : 'other', error: short, message: `Update failed: ${short}` });
  });

  autoUpdater.checkForUpdates().catch(() => {});
}

ipcMain.handle('notify:show', (_e, n) => {
  if (!Notification.isSupported()) return { ok: false };
  const note = new Notification({
    title: String((n && n.title) || 'Mir4Local').slice(0, 120),
    body: String((n && n.body) || '').slice(0, 300),
    silent: true, // sounds are handled by the app's own reminder setting
  });
  liveNotes.add(note);
  note.on('close', () => liveNotes.delete(note));
  note.on('click', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  note.show();
  return { ok: true };
});

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('update:check', () => {
  if (app.isPackaged) autoUpdater.checkForUpdates().catch(() => {});
});
ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());

app.whenReady().then(() => {
  createWindow();
  win.webContents.once('did-finish-load', setupAutoUpdate);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
