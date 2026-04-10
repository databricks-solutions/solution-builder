/**
 * Type definitions for Electron IPC API.
 * These types match what's exposed in electron/preload.js
 */

export interface UpdateProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export interface UpdateStatus {
  available: boolean;
  checking: boolean;
  downloading: boolean;
  downloaded: boolean;
  error: string | null;
  currentVersion: string | null;
  newVersion: string | null;
  releaseNotes: string | null;
  progress: UpdateProgress | null;
}

export interface ElectronAPI {
  // Platform info
  platform: NodeJS.Platform;
  isElectron: boolean;

  // Version info
  versions: {
    electron: string;
    node: string;
    chrome: string;
  };

  // App version
  getAppVersion: () => Promise<string>;

  // Auto-update methods
  getUpdateStatus: () => Promise<UpdateStatus>;
  checkForUpdates: () => Promise<UpdateStatus>;
  downloadUpdate: () => Promise<UpdateStatus>;
  installUpdate: () => Promise<{ installing?: boolean; error?: string }>;

  // Listen for update status changes
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
