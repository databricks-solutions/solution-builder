/**
 * Template tile component for displaying templates on the home page and templates route.
 */

import { memo } from "react";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card";
import { Badge } from "../ui/badge";
import type { TemplateListItem, TemplateSearchResult } from "../../lib/custom-api";

interface TemplateTileProps {
  template: TemplateListItem | TemplateSearchResult;
  onClick: () => void;
  showSimilarity?: boolean;
}

export const TemplateTile = memo(function TemplateTile({
  template,
  onClick,
  showSimilarity = false,
}: TemplateTileProps) {
  // Check if it's a search result with similarity
  const similarity = "similarity" in template ? template.similarity : null;

  return (
    <Card
      className="group cursor-pointer transition-all hover:shadow-lg hover:border-primary/30 hover:-translate-y-0.5 h-full flex flex-col"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <h3 className="font-semibold text-base line-clamp-2 group-hover:text-primary transition-colors">
          {template.name}
        </h3>
      </CardHeader>

      <CardContent className="pb-2 flex-1">
        {template.description && (
          <p className="text-sm text-muted-foreground line-clamp-3">
            {template.description}
          </p>
        )}
      </CardContent>

      <CardFooter className="pt-2 border-t border-border/30 mt-auto">
        <div className="flex items-center justify-between w-full text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            {showSimilarity && similarity !== null && (
              <span className="flex items-center gap-1">
                <MatchIcon className="h-3 w-3" />
                {Math.round(similarity * 100)}% match
              </span>
            )}
            {template.industry && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
                {template.industry}
              </Badge>
            )}
            {!showSimilarity && !template.industry && (
              <span>Template</span>
            )}
          </div>
          <span className="opacity-0 group-hover:opacity-100 transition-opacity text-primary font-medium">
            View →
          </span>
        </div>
      </CardFooter>
    </Card>
  );
});

function MatchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

export default TemplateTile;
