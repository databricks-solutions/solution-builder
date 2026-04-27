/**
 * Template tile component for displaying templates on the home page and templates route.
 */

import { memo } from "react";
import { Badge } from "../ui/badge";
import { Layers, ArrowUpRight, CheckCircle, Clock, XCircle } from "lucide-react";
import type { TemplateListItem, TemplateSearchResult } from "../../lib/custom-api";

interface TemplateTileProps {
  template: TemplateListItem | TemplateSearchResult;
  onClick: () => void;
  showSimilarity?: boolean;
  showStatus?: boolean;
}

export const TemplateTile = memo(function TemplateTile({
  template,
  onClick,
  showSimilarity = false,
  showStatus = false,
}: TemplateTileProps) {
  const similarity = "similarity" in template ? template.similarity : null;
  const status = "status" in template ? template.status : null;
  const ownerEmail = "owner_email" in template ? template.owner_email : null;
  const isSeeded = ownerEmail === "system@databricks.com";

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative text-left w-full rounded-xl border border-primary/[0.08] bg-card/60 backdrop-blur-lg shadow-sm shadow-primary/[0.03] overflow-hidden transition-all duration-200 hover:shadow-lg hover:shadow-primary/[0.08] hover:border-primary/20 hover:-translate-y-0.5 h-full flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
    >
      <div className="p-4 pb-3 flex-1">
        {/* Title row */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-semibold text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors">
            {template.name}
          </h3>
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/0 group-hover:text-primary transition-all mt-0.5" />
        </div>

        {/* Description */}
        {template.description && (
          <p className="text-xs text-muted-foreground/80 line-clamp-3 leading-relaxed">
            {template.description}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-primary/[0.06] bg-primary/[0.02] mt-auto">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground/70">
          <div className="flex items-center gap-2">
            {showSimilarity && similarity !== null && (
              <span className="flex items-center gap-1 text-primary/80 font-medium">
                <Layers className="h-3 w-3" />
                {Math.round(similarity * 100)}% match
              </span>
            )}
            {template.industry && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-primary/10 bg-primary/[0.03]">
                {template.industry}
              </Badge>
            )}
            {!showSimilarity && !template.industry && (
              <span>Template</span>
            )}
          </div>
          {showStatus && status && (
            <Badge
              variant={
                status === "APPROVED"
                  ? "default"
                  : status === "REVIEW_REQUESTED"
                    ? "secondary"
                    : "destructive"
              }
              className={`text-[11px] px-2 py-0.5 h-5 gap-1 ${
                status === "APPROVED"
                  ? isSeeded
                    ? "bg-primary/15 hover:bg-primary/20 text-primary border-primary/20"
                    : "bg-green-600 hover:bg-green-700 text-white"
                  : ""
              }`}
            >
              {status === "APPROVED" ? (
                isSeeded ? (
                  <Layers className="h-3 w-3" />
                ) : (
                  <CheckCircle className="h-3 w-3" />
                )
              ) : status === "REVIEW_REQUESTED" ? (
                <Clock className="h-3 w-3" />
              ) : (
                <XCircle className="h-3 w-3" />
              )}
              {status === "APPROVED"
                ? isSeeded
                  ? "Databricks"
                  : "Approved"
                : status === "REVIEW_REQUESTED"
                  ? "Pending Review"
                  : "Rejected"}
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
});

export default TemplateTile;
