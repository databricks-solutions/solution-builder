/**
 * Shared types for the preview module. See backend/preview/README.md.
 * Self-contained — nothing outside `ui/preview/` should import from here.
 */

export type PreviewStatus = "stopped" | "starting" | "ready" | "failed";
export type LogStream = "stdout" | "stderr" | "system";

export interface PreviewState {
  project_id: string;
  status: PreviewStatus;
  port: number | null;
  pid: number | null;
  last_seq: number;
  has_start_script: boolean;
}

export interface PreviewLogLine {
  seq: number;
  stream: LogStream;
  text: string;
}

/** The events an SSE client may receive (other than comment-only keepalives). */
export type PreviewEvent =
  | { kind: "state"; state: PreviewState }
  | { kind: "log"; line: PreviewLogLine };
