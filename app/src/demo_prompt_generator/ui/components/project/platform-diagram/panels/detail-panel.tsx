/**
 * platform-diagram/panels/detail-panel — the right-hand detail panel shown when
 * a node is selected: icon + label + band, description, and a deep-link button.
 */
import { memo } from "react";
import { type PlatformComponent } from "@/lib/platform-architecture";
import { Button } from "@/components/ui/button";
import { X, ExternalLink } from "lucide-react";
import { BrandMark } from "../brand-mark";

export const DetailPanel = memo(function DetailPanel({
  component,
  bandLabel,
  bandColor,
  deepLink,
  onClose,
}: {
  component: PlatformComponent;
  bandLabel: string;
  bandColor: string;
  deepLink: string | null;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-start justify-between gap-2 border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-background"
            style={{ boxShadow: `inset 0 0 0 1px ${bandColor}33` }}
          >
            <BrandMark iconKey={component.icon} label={component.label} bandColor={bandColor} allowTrademark className="h-6 w-6" />
          </span>
          <div>
            <div className="text-[15px] font-bold leading-tight text-foreground">{component.label}</div>
            <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: bandColor }}>
              {bandLabel}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <p className="text-[13.5px] leading-relaxed text-foreground/90">{component.desc}</p>
        {deepLink && (
          <a
            href={deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] font-semibold text-primary-foreground hover:opacity-90"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in workspace
          </a>
        )}
      </div>
    </div>
  );
});
