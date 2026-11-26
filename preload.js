const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getVersion: () => ipcRenderer.invoke('app:version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_e, data) => cb(data)),
  loadMissions: (opts) => ipcRenderer.invoke('missions:load', opts),
  notify: (n) => ipcRenderer.invoke('notify:show', n),
  notifyStatus: () => 'granted',
  setLabels: (l) => ipcRenderer.invoke('labels:set', l),
  getCloseBehavior: () => ipcRenderer.invoke('close:get'),
  setCloseBehavior: (v) => ipcRenderer.invoke('close:set', v),
});
