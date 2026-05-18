/**
 * Thin API wrappers for the preview module. The only place in the UI that
 * knows the `/api/preview/*` path shape.
 */

import { apiUrl } from "@/lib/config";
import type { PreviewLogLine, PreviewState } from "./types";

export interface DetectedError {
  summary: string;
  snippet: string;
  severity: "low" | "medium" | "high";
}

export interface AnalyzeLogsResponse {
  errors: DetectedError[];
}

/** Mini-LLM judge: scan a recent window of log lines and report real errors.
 *  Replaces the old regex-based isErrorLine heuristic in useAutoFixErrors. */
export async function analyzePreviewLogs(
  projectId: string,
  lines: PreviewLogLine[],
): Promise<AnalyzeLogsResponse> {
  const r = await fetch(apiUrl(`/api/preview/${projectId}/analyze-logs`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lines }),
  });
  if (!r.ok) throw await _err(r, "analyze-logs");
  return r.json();
}

export async function startPreview(projectId: string): Promise<PreviewState> {
  const r = await fetch(apiUrl(`/api/preview/${projectId}/start`), {
    method: "POST",
  });
  if (!r.ok) throw await _err(r, "start");
  return r.json();
}

export async function stopPreview(projectId: string): Promise<PreviewState> {
  const r = await fetch(apiUrl(`/api/preview/${projectId}/stop`), {
    method: "POST",
  });
  if (!r.ok) throw await _err(r, "stop");
  return r.json();
}

export async function restartPreview(projectId: string): Promise<PreviewState> {
  const r = await fetch(apiUrl(`/api/preview/${projectId}/restart`), {
    method: "POST",
  });
  if (!r.ok) throw await _err(r, "restart");
  return r.json();
}

export async function getPreviewState(projectId: string): Promise<PreviewState> {
  const r = await fetch(apiUrl(`/api/preview/${projectId}/state`));
  if (!r.ok) throw await _err(r, "state");
  return r.json();
}

export async function pingPreview(projectId: string): Promise<void> {
  await fetch(apiUrl(`/api/preview/${projectId}/ping`), { method: "POST" }).catch(
    () => {
      /* ping failures are non-fatal; the reconnecting SSE will recover */
    },
  );
}

/**
 * URL used as the iframe's `src`.
 *
 * Goes through the `/preview/<id>/` proxy so the same code path works both
 * locally and when deployed to Databricks Apps (where the child process is
 * reachable only via the parent's single URL). The proxy serves the child's
 * HTML with a runtime shim + path rewrites that make absolute-path URLs
 * (`/@vite/client`, `/api/*`, HMR ws) resolve back through the proxy.
 */
export function previewFrameUrl(projectId: string): string {
  return apiUrl(`/preview/${projectId}/`);
}

/** URL for the SSE stream (with cursor). Used by the reconnecting client. */
export function previewEventsUrl(projectId: string, since: number): string {
  return apiUrl(`/api/preview/${projectId}/events?since=${since}`);
}

async function _err(r: Response, verb: string): Promise<Error> {
  let detail = "";
  try {
    const body = await r.json();
    detail = body?.detail ?? body?.error ?? "";
  } catch {
    /* noop */
  }
  return new Error(`preview ${verb} failed (${r.status}): ${detail || r.statusText}`);
}
