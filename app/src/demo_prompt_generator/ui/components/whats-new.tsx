// "What's new": a navbar button and a short dialog: the features on the left, a slider of
// examples on the right (one slide per feature; it advances on its own, a click on a feature
// jumps to its slide). Opens once per RELEASE for returning users (the welcome guide covers a
// first visit). Bump RELEASE and edit FEATURES for the next round.
import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, Bot, Check, Copy, FileText, Network, Sparkles, Table2 } from "lucide-react";
import { DATABRICKS_ICONS } from "@/components/databricks-icons";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const RELEASE = "2026-11";
const SEEN_KEY = "sb:whats-new-seen";
const GUIDE_KEY = "guide-seen-v4"; // components/guide/guide-modal.tsx
const SLIDE_MS = 4500;

/** A Databricks mark from the app's icon set (the same art the diagrams use). */
const Mark = ({ name, className }: { name: keyof typeof DATABRICKS_ICONS; className?: string }) => {
  const Icon = DATABRICKS_ICONS[name] as (p: { className?: string }) => ReactNode;
  return <Icon className={className} />;
};

const Card = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("rounded-xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]", className)}>{children}</div>
);

const Label = ({ children }: { children: ReactNode }) => (
  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">{children}</p>
);

function GenieSlide() {
  const old: [keyof typeof DATABRICKS_ICONS, string][] = [["knowledgeAssistant", "Knowledge Assistant"], ["multiAgentSupervisor", "Supervisor Agent"], ["genieBrand", "Genie space"]];
  return (
    <div className="grid w-full max-w-[420px] gap-5">
      <div>
        <Label>Before · three agents to wire</Label>
        <div className="grid grid-cols-3 gap-2">
          {old.map(([icon, label]) => (
            <Card key={label} className="flex flex-col items-center gap-1.5 px-2 py-3 opacity-60 grayscale">
              <Mark name={icon} className="h-6 w-6" />
              <span className="text-center text-[10px] leading-tight text-zinc-500 line-through decoration-zinc-400">{label}</span>
            </Card>
          ))}
        </div>
      </div>
      <div>
        <Label>Now · one agent</Label>
        <Card className="flex items-center gap-3 p-3.5 ring-1 ring-red-200">
          <Mark name="genieBrand" className="h-9 w-9 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-zinc-900">Genie agent</p>
            <div className="mt-1.5 flex gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600"><Table2 className="h-3 w-3" /> Tables</span>
              <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600"><FileText className="h-3 w-3" /> PDFs</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ArchitectureSlide() {
  const styles = [["marketing", "Slide"], ["technical", "Technical"], ["networking", "Networking"], ["lifecycle", "Lifecycle"]];
  return (
    <div className="grid w-full grid-cols-2 gap-3">
      {styles.map(([id, label]) => (
        <Card key={id} className="overflow-hidden">
          <img src={`/arch-styles/${id}.png`} alt={`${label} architecture`} className="aspect-[4/3] w-full bg-white object-contain p-1.5" />
          <p className="border-t border-zinc-100 px-2.5 py-1.5 text-[11px] font-medium text-zinc-600">{label}</p>
        </Card>
      ))}
    </div>
  );
}


function WorkshopSlide() {
  const steps = ["Ingest the raw files", "Build the silver tables", "Create the dashboard"];
  return (
    <Card className="w-full max-w-[420px] overflow-hidden">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
        <Mark name="genieCodeBrand" className="h-5 w-5" />
        <span className="text-xs font-semibold text-zinc-800">Returns workshop</span>
        <span className="ml-auto text-[10px] text-zinc-400">Step 2 of 6</span>
      </div>
      <div className="space-y-2 p-3">
        {steps.map((s, i) => (
          <div key={s} className={cn("flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs", i === 1 ? "border-red-200 bg-red-50/50" : "border-zinc-100")}>
            {i === 0 ? (
              <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500 text-white"><Check className="h-3 w-3" /></span>
            ) : (
              <span className={cn("grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold", i === 1 ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-500")}>{i + 1}</span>
            )}
            <span className={cn("flex-1", i === 0 ? "text-zinc-400" : "text-zinc-800")}>{s}</span>
            {i === 1 && <span className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 shadow-sm"><Copy className="h-3 w-3" /> Prompt</span>}
          </div>
        ))}
      </div>
    </Card>
  );
}


interface Feature {
  icon: typeof Sparkles;
  title: string;
  text: string;
  link?: { label: string; href: string };
  slide: ReactNode;
}

const FEATURES: Feature[] = [
  { icon: Bot, title: "One Genie agent for data and documents", text: "Tables and PDFs, one agent. No more Knowledge Assistant or Supervisor Agent.", slide: <GenieSlide /> },
  { icon: Network, title: "Architecture diagrams worth a slide", text: "Describe it or drop a picture.", link: { label: "See examples", href: "/architecture-showcase" }, slide: <ArchitectureSlide /> },
  { icon: BookOpen, title: "Genie Code workshops", text: "Prompts your attendees build live, plus the data.", link: { label: "Try one", href: "/?start=workshop" }, slide: <WorkshopSlide /> },
];

export function WhatsNew() {
  const [open, setOpen] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN_KEY) === RELEASE) return;
      if (!localStorage.getItem(GUIDE_KEY)) {
        // A first visit: the welcome guide covers it. Don't stack a second popup.
        localStorage.setItem(SEEN_KEY, RELEASE);
        return;
      }
      setUnseen(true);
      setOpen(true);
    } catch {
      // No storage: never auto-open.
    }
  }, []);

  useEffect(() => {
    if (!open || paused) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % FEATURES.length), SLIDE_MS);
    return () => clearInterval(t);
  }, [open, paused]);

  const change = (o: boolean) => {
    setOpen(o);
    if (!o) {
      setUnseen(false);
      try { localStorage.setItem(SEEN_KEY, RELEASE); } catch { /* ignore */ }
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" className="relative h-8 gap-1.5 px-2 text-xs" onClick={() => { setIndex(0); setOpen(true); }} title="What's new">
        <Sparkles className="h-4 w-4" />
        <span className="hidden md:inline">What's new</span>
        {unseen && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-destructive" />}
      </Button>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <div className="grid sm:grid-cols-[1fr_1.25fr]">
            <div className="flex flex-col p-6">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-destructive" /> What's new</DialogTitle>
                <DialogDescription>What I can do for you now.</DialogDescription>
              </DialogHeader>
              <ul className="mt-4 space-y-1">
                {FEATURES.map((f, i) => (
                  <li key={f.title}>
                    <button
                      type="button"
                      onClick={() => setIndex(i)}
                      onMouseEnter={() => { setIndex(i); setPaused(true); }}
                      onMouseLeave={() => setPaused(false)}
                      className={cn("flex w-full cursor-pointer gap-3 rounded-lg p-2 text-left transition-colors", i === index ? "bg-muted" : "hover:bg-muted/50")}
                    >
                      <f.icon className={cn("mt-0.5 h-4 w-4 shrink-0", i === index ? "text-destructive" : "text-muted-foreground")} />
                      <span className="text-sm">
                        <span className="block font-medium">{f.title}</span>
                        {i === index && <span className="mt-0.5 block text-muted-foreground">{f.text}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex items-center justify-between pt-4">
                {FEATURES[index].link ? (
                  <a href={FEATURES[index].link!.href} className="text-sm font-medium underline-offset-4 hover:underline">{FEATURES[index].link!.label} →</a>
                ) : <span />}
                <Button size="sm" onClick={() => change(false)}>Got it</Button>
              </div>
            </div>
            {/* The slider: one example per feature, crossfading. */}
            <div className="relative hidden min-h-[520px] border-l border-zinc-100 bg-gradient-to-br from-zinc-50 via-white to-red-50/40 sm:block" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
              {FEATURES.map((f, i) => (
                <div key={f.title} aria-hidden={i !== index}
                  className={cn("absolute inset-0 flex items-center justify-center px-7 pb-10 pt-7 transition-all duration-500", i === index ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1 opacity-0")}>
                  {f.slide}
                </div>
              ))}
              <div className="absolute inset-x-0 bottom-4 flex justify-center gap-1.5">
                {FEATURES.map((f, i) => (
                  <button key={f.title} type="button" aria-label={f.title} onClick={() => setIndex(i)}
                    className={cn("h-1.5 cursor-pointer rounded-full transition-all", i === index ? "w-5 bg-zinc-800" : "w-1.5 bg-zinc-300 hover:bg-zinc-400")} />
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
