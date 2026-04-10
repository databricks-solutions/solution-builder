/**
 * Demo Prompt Generator - Electron Preload Script
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

  // Future: Add IPC methods as needed
  // send: (channel, data) => ipcRenderer.send(channel, data),
  // receive: (channel, callback) => ipcRenderer.on(channel, callback),
});

console.log('Preload script loaded');
