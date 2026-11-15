const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('toast', {
  click: () => ipcRenderer.send('toast:click'),
  close: () => ipcRenderer.send('toast:close'),
});
