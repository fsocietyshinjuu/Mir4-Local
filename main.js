const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 960,
    height: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function setupAutoUpdate() {
  // Updates only work in packaged builds, not with `npm start`.
  if (!app.isPackaged) {
    send('update:status', { state: 'dev', message: 'Update checks are disabled in development.' });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () =>
    send('update:status', { state: 'checking', message: 'Checking for updates…' }));
  autoUpdater.on('update-available', (info) =>
    send('update:status', { state: 'available', message: `Version ${info.version} found. Downloading…` }));
  autoUpdater.on('update-not-available', () =>
    send('update:status', { state: 'current', message: 'You are on the latest version.' }));
  autoUpdater.on('download-progress', (p) =>
    send('update:status', { state: 'downloading', percent: Math.round(p.percent), message: 'Downloading update…' }));
  autoUpdater.on('update-downloaded', (info) =>
    send('update:status', { state: 'ready', message: `Version ${info.version} is ready to install.` }));
  autoUpdater.on('error', (err) =>
    send('update:status', { state: 'error', message: `Update failed: ${err.message}` }));

  autoUpdater.checkForUpdates().catch(() => {});
}

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
