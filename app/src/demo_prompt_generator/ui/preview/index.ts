/**
 * Public surface of the preview module. Only this file is imported from outside
 * `ui/preview/`. See backend/preview/README.md for the removal checklist.
 */

import type { MutableRefObject } from "react";
import type { AutoFixApi } from "./AppPreviewTab";

export { AppPreviewTab } from "./AppPreviewTab";
export type { AutoFixApi } from "./AppPreviewTab";
export { useAppPreview } from "./useAppPreview";
export { previewFrameUrl } from "./api";
export type { PreviewState, PreviewStatus, PreviewLogLine } from "./types";

/** Ref type for the auto-fix API handle, exported for parent components. */
export type AutoFixApiRef = MutableRefObject<AutoFixApi | null>;
