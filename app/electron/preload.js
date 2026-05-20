/**
 * Databricks Solution Builder - Electron Preload Script
 *
 * Exposes limited APIs to the renderer process via contextBridge.
 * This maintains security while allowing necessary IPC.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform info
  platform: process.platform,
  isElectron: true,

  // Version info
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },

  // App version
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Auto-update methods
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // Listen for update status changes
  onUpdateStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('update-status', handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener('update-status', handler);
  },
});

console.log('Preload script loaded');
