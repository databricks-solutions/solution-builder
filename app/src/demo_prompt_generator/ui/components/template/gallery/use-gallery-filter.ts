/**
 * Small filtering hook shared by the template galleries: industry + free-text
 * search over a TemplateListItem[] (searches name + description + industry +
 * capabilities).
 */

import { useMemo } from "react";
import type { TemplateListItem } from "@/lib/custom-api";

function searchBlob(t: TemplateListItem): string {
  return [
    t.name,
    t.description ?? "",
    t.industry ?? "",
    ...(t.capabilities ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

export function useGalleryFilter(
  templates: TemplateListItem[],
  industry: string | null,
  search: string,
): TemplateListItem[] {
  return useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (industry && t.industry !== industry) return false;
      if (q && !searchBlob(t).includes(q)) return false;
      return true;
    });
  }, [templates, industry, search]);
}
