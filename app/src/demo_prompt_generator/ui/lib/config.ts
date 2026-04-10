/**
 * Application configuration for different environments.
 *
 * In Electron mode, the API runs on a different port and we need to use
 * absolute URLs. In web mode (dev server), we use relative URLs and
 * rely on Vite's proxy.
 */

declare global {
  const __API_BASE_URL__: string;
  const __IS_ELECTRON__: boolean;
}

// API base URL - empty in web mode (uses Vite proxy), full URL in Electron
export const API_BASE_URL: string =
  typeof __API_BASE_URL__ !== "undefined" ? __API_BASE_URL__ : "";

// Whether running in Electron
export const IS_ELECTRON: boolean =
  typeof __IS_ELECTRON__ !== "undefined"
    ? __IS_ELECTRON__
    : typeof window !== "undefined" &&
      !!(window as { electronAPI?: unknown }).electronAPI;

/**
 * Build a full API URL from a path.
 * In Electron mode, prepends the API base URL.
 * In web mode, returns the path as-is (uses Vite proxy).
 */
export function apiUrl(path: string): string {
  if (!path.startsWith("/")) {
    path = "/" + path;
  }
  return API_BASE_URL + path;
}

/**
 * Build an asset URL from a path.
 * In Electron mode (file:// protocol), uses relative paths.
 * In web mode, uses absolute paths from root.
 */
export function assetUrl(path: string): string {
  if (!path.startsWith("/")) {
    path = "/" + path;
  }
  // In Electron, use relative path (remove leading slash)
  if (IS_ELECTRON) {
    return "." + path;
  }
  return path;
}
