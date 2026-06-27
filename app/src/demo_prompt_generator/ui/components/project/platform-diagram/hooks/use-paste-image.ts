/**
 * platform-diagram/hooks/use-paste-image — Ctrl/Cmd+V to drop a pasted image
 * onto the canvas as a downscaled base64 image annotation at the canvas center.
 *
 * Lives in a hook so it can take `addAnnotation` as a plain argument (it's
 * declared far below the old inline effect in Canvas), eliminating the
 * addAnnotationRef use-before-define hack. Ignored when typing in an
 * input/textarea, and a no-op outside edit mode.
 */
import { useEffect } from "react";
import { type RefObject } from "react";
import {
  type AnnotationData,
  type AnnotationVariant,
} from "@/lib/platform-architecture";
import { imageFileToDownscaledDataUrl } from "../annotations";

export function usePasteImage({
  editMode,
  addAnnotation,
  screenToFlowPosition,
  wrapRef,
}: {
  editMode: boolean;
  addAnnotation: (v: AnnotationVariant, at?: { x: number; y: number }, extra?: Partial<AnnotationData>) => void;
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number };
  wrapRef: RefObject<HTMLDivElement | null>;
}) {
  useEffect(() => {
    if (!editMode) return;
    const onPaste = async (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      if (!item) return;
      const file = item.getAsFile();
      if (!file) return;
      e.preventDefault();
      const src = await imageFileToDownscaledDataUrl(file);
      // Warn (but still allow) if the encoded image is large.
      if (src.length > 1.5 * 1024 * 1024) {
        // eslint-disable-next-line no-console
        console.warn(`[platform-diagram] pasted image is large (${Math.round(src.length / 1024)}KB base64) — architecture.md will grow.`);
      }
      const rect = wrapRef.current?.getBoundingClientRect();
      const at = rect
        ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
        : { x: 200, y: 200 };
      addAnnotation("image", at, { src });
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [editMode, addAnnotation, screenToFlowPosition, wrapRef]);
}
