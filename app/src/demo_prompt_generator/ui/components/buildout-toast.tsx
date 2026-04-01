import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useBuildoutStore, BUILDOUT_TOTAL_FILES } from "@/lib/buildout-store";

/**
 * Headless component that subscribes to the buildout store and drives
 * sonner toast notifications for background buildout progress.
 * Mount once in __root.tsx alongside <Toaster />.
 */
export function BuildoutToast() {
  const status = useBuildoutStore((s) => s.status);
  const demoName = useBuildoutStore((s) => s.demoName);
  const currentFile = useBuildoutStore((s) => s.currentFile);
  const completedCount = useBuildoutStore((s) => s.completedFiles.length);
  const generationId = useBuildoutStore((s) => s.generationId);
  const error = useBuildoutStore((s) => s.error);
  const prevStatus = useRef(status);

  useEffect(() => {
    const toastId = "buildout-progress";

    if (status === "building") {
      toast.loading(
        `Building ${demoName || "demo"}... (${completedCount}/${BUILDOUT_TOTAL_FILES})`,
        {
          id: toastId,
          description: currentFile ? `Generating ${currentFile}...` : "Starting...",
          duration: Infinity,
          action: {
            label: "Stop",
            onClick: () => useBuildoutStore.getState().stopBuildout(),
          },
        },
      );
    } else if (status === "complete" && prevStatus.current === "building") {
      toast.success(`${demoName || "Demo"} package is ready!`, {
        id: toastId,
        duration: 10000,
        action: generationId
          ? {
              label: "View",
              onClick: () => {
                window.location.href = `/workspace?generationId=${generationId}&topic=`;
              },
            }
          : undefined,
      });
    } else if (status === "stopped" && prevStatus.current === "building") {
      toast.info(
        `Generation paused (${completedCount}/${BUILDOUT_TOTAL_FILES} files complete)`,
        {
          id: toastId,
          duration: 15000,
          action: {
            label: "Resume",
            onClick: () => {
              const state = useBuildoutStore.getState();
              if (state.generationId) {
                state.resumeBuildout(
                  state.generationId,
                  state.demoName,
                  state.files,
                  state.userArchitecture,
                );
              }
            },
          },
        },
      );
    } else if (status === "error" && prevStatus.current !== "error") {
      toast.error(error || "Buildout failed", {
        id: toastId,
        duration: 10000,
      });
    } else if (status === "idle" && prevStatus.current !== "idle") {
      toast.dismiss(toastId);
    }

    prevStatus.current = status;
  }, [status, currentFile, completedCount, demoName, generationId, error]);

  return null;
}
