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

// Bump suffix when slide content changes materially so returning users see the
// new guide once on next visit.
const STORAGE_KEY = "guide-seen-v2";

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
  // The Carousel component already handles arrows via onKeyDownCapture when
  // focus is inside it — bail out via defaultPrevented so we don't double-step.
  useEffect(() => {
    if (!open || !api) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
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
  const currentSection = GUIDE_SLIDES[selectedIndex]?.section;
  const sectionPosition = (() => {
    if (!currentSection) return null;
    const sectionSlides = GUIDE_SLIDES.filter((s) => s.section === currentSection);
    const indexWithin =
      sectionSlides.findIndex((s) => s.id === GUIDE_SLIDES[selectedIndex].id) + 1;
    return { current: indexWithin, total: sectionSlides.length };
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] gap-0 p-0 overflow-hidden flex flex-col sm:max-w-3xl">
        {currentSection && (
          <div className="shrink-0 border-b border-border/40 bg-muted/15 px-5 py-2.5 flex items-center gap-3 pr-12">
            <span className="text-[10px] uppercase tracking-[0.2em] font-semibold text-primary">
              {currentSection}
            </span>
            {sectionPosition && (
              <span className="text-[10px] tabular-nums text-muted-foreground/70">
                {sectionPosition.current} / {sectionPosition.total}
              </span>
            )}
          </div>
        )}
        <Carousel
          opts={{ loop: false }}
          setApi={setApi}
          className="relative w-full flex-1 min-h-0 [&>div]:h-full"
        >
          <CarouselContent className="ml-0 h-full">
            {GUIDE_SLIDES.map((slide, idx) => {
              const SlideVisual = slide.Visual;
              const showMedia = !!SlideVisual || !!slide.gif;
              return (
                <CarouselItem key={slide.id} className="pl-0 h-full">
                  <div className="flex flex-col h-full">
                    {showMedia && (
                      <div className="w-full h-[260px] shrink-0 bg-muted/20 border-b border-border/40 flex items-center justify-center overflow-hidden">
                        {SlideVisual ? (
                          <SlideVisual active={idx === selectedIndex} />
                        ) : (
                          <img
                            src={slide.gif}
                            alt={slide.alt ?? slide.title}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              // Hide the broken image so the placeholder stays neutral
                              // until a GIF is dropped in public/GIFs/.
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                          />
                        )}
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
              );
            })}
          </CarouselContent>
          {/*
            Arrow buttons are pinned to the vertical center of the 260px visual
            area so they always sit over (and animate with) the artwork. Slide
            content keeps horizontal padding clear of these buttons.
          */}
          <button
            type="button"
            onClick={() => api?.scrollPrev()}
            disabled={isFirst}
            aria-label="Previous slide"
            className={cn(
              "absolute left-3 top-[130px] z-30 -translate-y-1/2",
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
              "absolute right-3 top-[130px] z-30 -translate-y-1/2",
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
