const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('admin', {
  init: () => ipcRenderer.invoke('admin:init'),
  saveDraft: (draft) => ipcRenderer.invoke('draft:save', draft),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  pull: () => ipcRenderer.invoke('github:pull'),
  publish: (data) => ipcRenderer.invoke('github:publish', data),
});
