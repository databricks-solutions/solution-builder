/**
 * BrandCard — "customize your demo for a real company" block on the project
 * overview. Three states:
 *   - no company yet   → inline input + "Get branding information"
 *   - company, no brand → "We'll match this company's branding: X" + button
 *   - resolved          → palette swatches + "Show details" (popup w/ mini-site)
 *
 * "Get branding information" calls the brand endpoint (setProjectBrand, search),
 * which resolves the palette/website, saves brand/{brand.json, company_logo, website.png},
 * and returns the refreshed Project. The details popup can also re-search or edit
 * the palette by hand.
 *
 * Rendered as a slim blue strip under the "Databricks resources" header.
 */
import { useEffect, useState } from "react";
import { Palette, Loader2, Search, Sparkles, ExternalLink, X, Plus, ChevronDown } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { setProjectBrand, getProjectFile, type Project, type ProjectBrand } from "@/lib/custom-api";
import { cn } from "@/lib/utils";

/** Bare brand filename (from brand.json) → its project-root-relative path.
 *  Brand files live under `brand/`; the JSON stores bare names. */
const BRAND_DIR = "brand";
function brandPath(name: string | null | undefined): string | null {
  return name ? `${BRAND_DIR}/${name}` : null;
}

/** Lazily load a project image file (project-root-relative path) as a data-URL,
 *  deriving the mime from its extension. Null until loaded/absent.
 *
 *  getProjectFile returns `content` as raw TEXT for UTF-8-decodable files (SVG)
 *  and as BASE64 for binary (PNG/JPG). SVG → url-encode the raw markup; raster
 *  → keep the base64 payload. (Base64-labeling raw SVG XML renders nothing.) */
function useProjectImage(projectId: string, file: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    if (!file) return;
    const ext = file.split(".").pop()?.toLowerCase();
    getProjectFile(projectId, file)
      .then((f) => {
        if (cancelled) return;
        if (ext === "svg") {
          setSrc(`data:image/svg+xml;utf8,${encodeURIComponent(f.content)}`);
        } else {
          const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
          setSrc(`data:${mime};base64,${f.content}`);
        }
      })
      .catch(() => !cancelled && setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [projectId, file]);
  return src;
}

/** Palette swatches wrapped in a white pill so they don't clash on a colored bg. */
function Swatches({ palette, className }: { palette: string[]; className?: string }) {
  if (!palette.length) return null;
  return (
    <div className={cn("flex items-center gap-1 rounded-md bg-white/95 px-1.5 py-1 shadow-sm", className)}>
      {palette.slice(0, 8).map((hex, i) => (
        <span
          key={`${hex}-${i}`}
          className="h-4 w-4 rounded-[3px] ring-1 ring-black/10"
          style={{ background: hex }}
          title={hex}
        />
      ))}
    </div>
  );
}

/** A transparency checkerboard — so both dark AND light (white) logos stay
 *  visible, regardless of what luminance the resolver picked. */
const CHECKER =
  "repeating-conic-gradient(#c4c4cc 0% 25%, #ffffff 0% 50%) 50% / 10px 10px";

/** Company logo on a checkerboard pill (handles logos of unknown color). */
function LogoPill({ src, className }: { src: string | null; className?: string }) {
  if (!src) return null;
  return (
    <span
      className={cn("flex h-8 items-center rounded-md px-2 shadow-sm", className)}
      style={{ background: CHECKER }}
    >
      <img src={src} alt="company logo" className="max-h-6 max-w-[96px] object-contain" />
    </span>
  );
}

export function BrandCard({
  project,
  onUpdated,
  className,
}: {
  project: Project;
  onUpdated: (p: Project) => void;
  className?: string;
}) {
  const brand: ProjectBrand | null = project.brand ?? null;
  const company = brand?.company || project.customer || "";
  // "resolved" = we ran the search and got SOMETHING back (palette, site, or
  // logo). A brand with only a website (empty palette) still counts, so it
  // doesn't get stranded back in the "not resolved yet" state.
  const hasBrand = !!(brand && (brand.palette.length || brand.website || brand.company_logo));
  const logoSrc = useProjectImage(project.id, brandPath(brand?.company_logo));

  // Pre-fill the input with the detected company (if any) so the user can edit
  // it before searching; the search saves whatever's typed.
  const [typed, setTyped] = useState(company);
  const [searching, setSearching] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve branding for a company name (inline button or the known company).
  const getBranding = async (name: string) => {
    if (!name.trim()) return;
    setSearching(true);
    setError(null);
    try {
      onUpdated(await setProjectBrand(project.id, { company: name.trim(), search: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't get branding");
    } finally {
      setSearching(false);
    }
  };

  return (
    <>
      <section
        className={cn(
          // the app's own primary blue (same hue as the buttons) so it reads as
          // one system, not a second clashing blue.
          "relative overflow-hidden rounded-xl bg-primary text-primary-foreground",
          "px-4 py-3",
          className,
        )}
      >

        {hasBrand ? (
          // ── Resolved: palette + logo + show-details ───────────────────────
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Sparkles className="h-4 w-4 text-primary-foreground/70" />
              <span className="text-sm font-semibold">We'll match {company}'s branding</span>
              <Swatches palette={brand!.palette} />
              <LogoPill src={logoSrc} />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 border-white/30 bg-white/10 text-white hover:bg-white/20"
              onClick={() => setDetailsOpen(true)}
            >
              Show details
            </Button>
          </div>
        ) : (
          // ── Not resolved yet — editable company + search. The input is
          //    pre-filled with any detected company; the search saves whatever
          //    the user leaves in it. ──────────────────────────────────────
          <div className="relative flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles className="h-4 w-4 shrink-0 text-primary-foreground/70" />
              <p className="text-sm font-semibold whitespace-nowrap">Customize the look &amp; feel for a real company:</p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="e.g. Databricks"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !searching) getBranding(typed);
                }}
                disabled={searching}
                className="h-9 w-48 border-white/25 bg-white/10 text-white placeholder:text-primary-foreground/50 focus-visible:ring-white/40"
              />
              <Button
                className="shrink-0 bg-white text-primary hover:bg-white/90"
                onClick={() => getBranding(typed)}
                disabled={searching || !typed.trim()}
              >
                {searching ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Matching…
                  </>
                ) : (
                  <>
                    <Search className="mr-1.5 h-4 w-4" /> Match branding
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {error && <p className="relative mt-2 text-sm text-red-200">{error}</p>}
      </section>

      {detailsOpen && (
        <BrandDetailsDialog
          project={project}
          onClose={() => setDetailsOpen(false)}
          onUpdated={onUpdated}
        />
      )}
    </>
  );
}

function BrandDetailsDialog({
  project,
  onClose,
  onUpdated,
}: {
  project: Project;
  onClose: () => void;
  onUpdated: (p: Project) => void;
}) {
  const brand = project.brand ?? null;
  const [company, setCompany] = useState(brand?.company || project.customer || "");
  const [palette, setPalette] = useState<string[]>(brand?.palette ?? []);
  const [website, setWebsite] = useState(brand?.website ?? "");
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forceRefresh, setForceRefresh] = useState(false);

  // Lazily load the mini-site screenshot + logo (project files → data URLs).
  const shotSrc = useProjectImage(project.id, brandPath(brand?.company_official_website_screenshot));
  const logoSrc = useProjectImage(project.id, brandPath(brand?.company_logo));

  const runSearch = async () => {
    if (!company.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const p = await setProjectBrand(project.id, {
        company: company.trim(),
        search: true,
        no_cache: forceRefresh,
      });
      setPalette(p.brand?.palette ?? []);
      setWebsite(p.brand?.website ?? "");
      onUpdated(p); // updates the project prop → useEffect re-fetches the new screenshot
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const save = async () => {
    if (!company.trim()) return;
    setSaving(true);
    setError(null);
    try {
      onUpdated(
        await setProjectBrand(project.id, {
          company: company.trim(),
          search: false,
          palette: palette.filter((h) => h.trim()),
          website: website.trim() || null,
        }),
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const busy = searching || saving;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Company branding</DialogTitle>
          <DialogDescription>
            Match a company's brand to personalize the demo. Re-search, or edit the palette by hand.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Company + re-search */}
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Company</label>
              <Input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="e.g. Databricks"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy) runSearch();
                }}
                disabled={busy}
              />
            </div>
            <Button onClick={runSearch} disabled={busy || !company.trim()}>
              {searching ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Searching…
                </>
              ) : (
                <>
                  <Search className="mr-1.5 h-4 w-4" /> Get branding
                </>
              )}
            </Button>
          </div>

          {/* Palette (editable) + logo on the right */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                <Palette className="mr-1 inline h-3.5 w-3.5" /> Palette
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {palette.map((hex, i) => (
                  <div key={i} className="group relative">
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#000000"}
                      onChange={(e) => {
                        const next = [...palette];
                        next[i] = e.target.value;
                        setPalette(next);
                      }}
                      className="h-9 w-9 cursor-pointer rounded-md border border-border/60 bg-transparent p-0"
                      title={hex}
                    />
                    <button
                      type="button"
                      onClick={() => setPalette(palette.filter((_, j) => j !== i))}
                      className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-background p-0.5 text-muted-foreground shadow group-hover:block hover:text-destructive"
                      title="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setPalette([...palette, "#3b82f6"])}
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary"
                  title="Add color"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
            {logoSrc && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Logo</label>
                <div
                  className="flex h-9 items-center justify-center rounded-md border px-3"
                  style={{ background: CHECKER }}
                >
                  <img src={logoSrc} alt={`${company} logo`} className="max-h-6 max-w-[120px] object-contain" />
                </div>
              </div>
            )}
          </div>

          {/* Website URL (above the screenshot, for coherence) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Website URL</label>
            <div className="flex items-center gap-2">
              <Input
                value={website ?? ""}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://company.com"
                disabled={busy}
              />
              {website && (
                <a
                  href={website}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-primary"
                  title={website}
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>

          {/* Website screenshot */}
          {shotSrc && (
            <div className="overflow-hidden rounded-lg border shadow-sm">
              <img src={shotSrc} alt={`${company} homepage`} className="w-full" />
            </div>
          )}

          {/* Advanced — force a fresh resolve (bypass + invalidate the cache) */}
          <details className="group text-xs">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground">
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
              Advanced
            </summary>
            <label className="mt-2 flex cursor-pointer items-center gap-2 pl-5 text-muted-foreground">
              <input
                type="checkbox"
                checked={forceRefresh}
                onChange={(e) => setForceRefresh(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              Ignore cached result and re-fetch (updates the cache)
            </label>
          </details>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !company.trim()}>
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BrandCard;
