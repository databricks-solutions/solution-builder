/**
 * Images pasted with ⌘V / Ctrl+V into the home prompt or the chat composer.
 * Both save them under the project's `context/uploads/` (home: at project
 * creation; chat: with the message), so the names here are what the agent sees.
 */
import type React from "react";

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

let pasteCount = 0;

/** Image files on the clipboard, renamed `pasted-<time>-<n>.png` (a screenshot
 *  always arrives as "image.png", so the real name carries nothing; the counter
 *  keeps two pastes in the same second apart). */
export function clipboardImages(e: React.ClipboardEvent): File[] {
  const files = Array.from(e.clipboardData.files).filter((f) => f.type in EXT);
  const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, "");
  return files.map(
    (f) => new File([f], `pasted-${stamp}-${++pasteCount}.${EXT[f.type]}`, { type: f.type }),
  );
}

/** True when the paste also carries text (copying from a web page puts both on
 *  the clipboard) — then the text paste must go through as usual. */
export function clipboardHasText(e: React.ClipboardEvent): boolean {
  return e.clipboardData.getData("text/plain").length > 0;
}

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
