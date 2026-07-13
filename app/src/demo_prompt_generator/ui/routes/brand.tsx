/**
 * /brand — a standalone brand-lookup test page. Type a company name, hit
 * resolve, and see the extracted logo candidates + color palette centered
 * below. The result view is the reusable <BrandResult> component (shared with
 * future in-app uses); this page just owns the input + fetch state.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BrandResult } from "@/components/brand/brand-result";
import { resolveBrand, type BrandOut } from "@/lib/custom-api";
import { Loader2, Search, ChevronDown } from "lucide-react";

export const Route = createFileRoute("/brand")({
  component: BrandPage,
});

function BrandPage() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [brand, setBrand] = useState<BrandOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forceRefresh, setForceRefresh] = useState(false);

  const run = async () => {
    const q = name.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setBrand(null);
    try {
      setBrand(await resolveBrand(q, { noCache: forceRefresh }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout>
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-10">
        <div className="mb-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Company Brand</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Resolve a company&rsquo;s logo &amp; color palette from just its name.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
          className="mt-6 flex w-full max-w-md items-center gap-2"
        >
          <Input
            autoFocus
            placeholder="e.g. Databricks, Rolls-Royce, Stripe"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={loading}
          />
          <Button type="submit" disabled={loading || !name.trim()}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            <span className="ml-1.5">Resolve</span>
          </Button>
        </form>

        {/* Advanced — force a fresh resolve (bypass + invalidate the cache) */}
        <details className="group mt-3 w-full max-w-md text-xs">
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

        <div className="mt-10 w-full">
          {loading && (
            <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">
                Searching, fetching &amp; extracting&hellip; this can take 15&ndash;40s.
              </p>
            </div>
          )}
          {error && !loading && (
            <p className="text-center text-sm text-destructive">{error}</p>
          )}
          {brand && !loading && <BrandResult brand={brand} />}
        </div>
      </div>
    </AppLayout>
  );
}
