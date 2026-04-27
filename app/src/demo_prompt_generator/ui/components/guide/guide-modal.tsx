import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { Button } from "@/components/ui/button";
import { Prose } from "@/components/markdown-prose";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { GUIDE_SLIDES } from "./slides";

const STORAGE_KEY = "guide-seen-v1";

interface GuideContextValue {
  open: () => void;
}

const GuideContext = createContext<GuideContextValue | null>(null);

export function useGuide(): GuideContextValue {
  const ctx = useContext(GuideContext);
  if (!ctx) {
    throw new Error("useGuide must be used within a <GuideProvider />");
  }
  return ctx;
}

interface GuideProviderProps {
  children: ReactNode;
}

export function GuideProvider({ children }: GuideProviderProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Auto-open on first launch.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (!window.localStorage.getItem(STORAGE_KEY)) {
        setIsOpen(true);
      }
    } catch {
      // localStorage may be unavailable (e.g. private mode). Skip auto-open silently.
    }
  }, []);

  const handleOpenChange = useCallback((next: boolean) => {
    setIsOpen(next);
    if (!next && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, "true");
      } catch {
        // Ignore — we'll just re-prompt next session.
      }
    }
  }, []);

  const open = useCallback(() => setIsOpen(true), []);

  const value = useMemo(() => ({ open }), [open]);

  return (
    <GuideContext.Provider value={value}>
      {children}
      <GuideModal open={isOpen} onOpenChange={handleOpenChange} />
    </GuideContext.Provider>
  );
}

interface GuideModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function GuideModal({ open, onOpenChange }: GuideModalProps) {
  const [api, setApi] = useState<CarouselApi>();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const slideCount = GUIDE_SLIDES.length;

  useEffect(() => {
    if (!api) return;
    setSelectedIndex(api.selectedScrollSnap());
    const onSelect = () => setSelectedIndex(api.selectedScrollSnap());
    api.on("select", onSelect);
    api.on("reInit", onSelect);
    return () => {
      api.off("select", onSelect);
    };
  }, [api]);

  // Reset to the first slide each time the modal opens.
  useEffect(() => {
    if (open && api) {
      api.scrollTo(0, true);
    }
  }, [open, api]);

  // Arrow-key navigation while the modal is open. Scoped to window because
  // Radix Dialog manages focus internally and the carousel root rarely owns it.
  useEffect(() => {
    if (!open || !api) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        api.scrollPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        api.scrollNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, api]);

  const isLast = selectedIndex === slideCount - 1;
  const isFirst = selectedIndex === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] gap-0 p-0 overflow-hidden flex flex-col">
        <Carousel
          opts={{ loop: false }}
          setApi={setApi}
          className="relative w-full flex-1 min-h-0 [&>div]:h-full"
        >
          <CarouselContent className="ml-0 h-full">
            {GUIDE_SLIDES.map((slide, idx) => (
              <CarouselItem key={slide.id} className="pl-0 h-full">
                <div className="flex flex-col h-full">
                  {slide.gif && (
                    <div className="w-full h-[220px] shrink-0 bg-muted/30 border-b border-border/40 flex items-center justify-center overflow-hidden">
                      <img
                        src={slide.gif}
                        alt={slide.alt ?? slide.title}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          // Hide the broken image until the user drops a GIF in
                          // public/guide/. The parent block keeps its placeholder height.
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </div>
                  )}
                  <div className="flex-1 min-h-0 overflow-y-auto p-6 pt-5">
                    <DialogHeader className="mb-3">
                      <DialogTitle>{slide.title}</DialogTitle>
                      <DialogDescription className="sr-only">
                        Step {idx + 1} of {slideCount}: {slide.title}
                      </DialogDescription>
                    </DialogHeader>
                    <Prose compact className="text-sm">
                      {slide.body}
                    </Prose>
                  </div>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <button
            type="button"
            onClick={() => api?.scrollPrev()}
            disabled={isFirst}
            aria-label="Previous slide"
            className={cn(
              "absolute left-3 top-[28%] z-30 -translate-y-1/2",
              "flex h-10 w-10 items-center justify-center rounded-full",
              "bg-background border border-border shadow-md",
              "text-foreground hover:bg-accent hover:text-accent-foreground",
              "transition-opacity cursor-pointer",
              "disabled:opacity-30 disabled:cursor-default disabled:hover:bg-background"
            )}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => api?.scrollNext()}
            disabled={isLast}
            aria-label="Next slide"
            className={cn(
              "absolute right-3 top-[28%] z-30 -translate-y-1/2",
              "flex h-10 w-10 items-center justify-center rounded-full",
              "bg-background border border-border shadow-md",
              "text-foreground hover:bg-accent hover:text-accent-foreground",
              "transition-opacity cursor-pointer",
              "disabled:opacity-30 disabled:cursor-default disabled:hover:bg-background"
            )}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </Carousel>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/40 bg-muted/20 px-6 py-3">
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Guide progress">
            {GUIDE_SLIDES.map((slide, idx) => (
              <button
                key={slide.id}
                type="button"
                role="tab"
                aria-selected={idx === selectedIndex}
                aria-label={`Go to slide ${idx + 1}: ${slide.title}`}
                onClick={() => api?.scrollTo(idx)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  idx === selectedIndex
                    ? "w-6 bg-primary"
                    : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60"
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => api?.scrollPrev()}
              disabled={selectedIndex === 0}
            >
              Back
            </Button>
            {isLast ? (
              <Button size="sm" onClick={() => onOpenChange(false)}>
                Get started
              </Button>
            ) : (
              <Button size="sm" onClick={() => api?.scrollNext()}>
                Next
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
