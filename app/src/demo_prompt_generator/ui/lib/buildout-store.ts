import { create } from "zustand";
import {
  approveProposal,
  streamBuildoutFile,
  savePartialBuildout,
  type WorkspaceEvent,
} from "./custom-api";

const PACKAGE_FILES = [
  "SKILL.md",
  "storyline.md",
  "architecture.md",
  "data-schema.md",
  "project-structure.md",
  "walkthrough.md",
] as const;

export type BuildoutStatus =
  | "idle"
  | "building"
  | "stopped"
  | "complete"
  | "error";

export interface BuildoutState {
  generationId: number | null;
  demoName: string;
  status: BuildoutStatus;
  currentFile: string | null;
  completedFiles: string[];
  files: Record<string, string>;
  error: string | null;
  userArchitecture: string | undefined;

  startBuildout: (
    generationId: number,
    demoName: string,
    userArchitecture?: string,
  ) => void;
  stopBuildout: () => void;
  resumeBuildout: (
    generationId: number,
    demoName: string,
    existingFiles: Record<string, string>,
    userArchitecture?: string,
  ) => void;
  reset: () => void;
}

// Module-level AbortController — not stored in zustand (not serializable)
let abortController: AbortController | null = null;

async function runBuildoutLoop(
  set: (partial: Partial<BuildoutState>) => void,
  get: () => BuildoutState,
  signal: AbortSignal,
) {
  const { generationId, userArchitecture } = get();
  if (!generationId) return;

  const completed = new Set(Object.keys(get().files));
  const remaining = PACKAGE_FILES.filter((f) => !completed.has(f));

  for (const filename of remaining) {
    if (signal.aborted) {
      set({ status: "stopped", currentFile: null });
      return;
    }

    set({ currentFile: filename });
    let content = "";

    try {
      for await (const event of streamBuildoutFile(
        generationId,
        filename,
        get().files,
        signal,
        userArchitecture,
      ) as AsyncGenerator<WorkspaceEvent>) {
        if (event.type === "file_content") {
          content += event.content;
          set({ files: { ...get().files, [filename]: content } });
        } else if (event.type === "file_complete") {
          if (event.content) content = event.content;
          const newFiles = { ...get().files, [filename]: content };
          const newCompleted = [...get().completedFiles, filename];
          set({
            files: newFiles,
            completedFiles: newCompleted,
            currentFile: null,
          });
          // Incremental save — fire and forget
          savePartialBuildout(generationId, newFiles).catch(() => {});
        } else if (event.type === "error") {
          set({
            status: "error",
            error: `Error generating ${filename}: ${event.content}`,
            currentFile: null,
          });
          return;
        }
      }
    } catch (err) {
      if (signal.aborted) {
        set({ status: "stopped", currentFile: null });
        return;
      }
      set({
        status: "error",
        error: `Failed generating ${filename}: ${err instanceof Error ? err.message : "Unknown error"}`,
        currentFile: null,
      });
      return;
    }
  }

  // Finalize — save all files and set stage to "package"
  try {
    await fetch("/api/workspace/buildout-finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generation_id: generationId,
        user_architecture: JSON.stringify(get().files),
      }),
    });
    set({ status: "complete", currentFile: null });
  } catch {
    set({
      status: "error",
      error: "Failed to finalize buildout",
      currentFile: null,
    });
  }
}

export const useBuildoutStore = create<BuildoutState>((set, get) => ({
  generationId: null,
  demoName: "",
  status: "idle",
  currentFile: null,
  completedFiles: [],
  files: {},
  error: null,
  userArchitecture: undefined,

  startBuildout: async (
    generationId: number,
    demoName: string,
    userArchitecture?: string,
  ) => {
    if (get().status === "building") return;

    abortController?.abort();
    abortController = new AbortController();

    set({
      generationId,
      demoName,
      status: "building",
      currentFile: null,
      completedFiles: [],
      files: {},
      error: null,
      userArchitecture,
    });

    try {
      await approveProposal(generationId);
    } catch (err) {
      set({
        status: "error",
        error: `Approval failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
      return;
    }

    await runBuildoutLoop(set, get, abortController.signal);
  },

  stopBuildout: () => {
    abortController?.abort();
    abortController = null;
    const { generationId, files } = get();
    set({ status: "stopped", currentFile: null });
    // Save partial progress
    if (generationId && Object.keys(files).length > 0) {
      savePartialBuildout(generationId, files).catch(() => {});
    }
  },

  resumeBuildout: async (
    generationId: number,
    demoName: string,
    existingFiles: Record<string, string>,
    userArchitecture?: string,
  ) => {
    if (get().status === "building") return;

    abortController?.abort();
    abortController = new AbortController();

    set({
      generationId,
      demoName,
      status: "building",
      currentFile: null,
      completedFiles: Object.keys(existingFiles),
      files: existingFiles,
      error: null,
      userArchitecture,
    });

    await runBuildoutLoop(set, get, abortController.signal);
  },

  reset: () => {
    abortController?.abort();
    abortController = null;
    set({
      generationId: null,
      demoName: "",
      status: "idle",
      currentFile: null,
      completedFiles: [],
      files: {},
      error: null,
      userArchitecture: undefined,
    });
  },
}));

export const BUILDOUT_TOTAL_FILES = PACKAGE_FILES.length;
