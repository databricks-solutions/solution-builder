import { ModeToggle } from "@/components/apx/mode-toggle";
import Logo from "@/components/apx/logo";
import { ReactNode, useRef, useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Menu,
  Sparkles,
  Library,
  History,
  Map,
  User,
} from "lucide-react";

interface NavbarProps {
  leftContent?: ReactNode;
  rightContent?: ReactNode;
}

const NAV_ITEMS = [
  { to: "/", label: "New Skill", icon: Sparkles },
  { to: "/library", label: "Library", icon: Library },
  { to: "/generations", label: "Generations", icon: History },
  { to: "/plan", label: "Plan", icon: Map },
  { to: "/profile", label: "Profile", icon: User },
] as const;

export function Navbar({ leftContent, rightContent }: NavbarProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <header className="z-50 bg-background/80 backdrop-blur-sm border-b border-border/80">
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="h-14 flex items-center justify-between px-4">
        {leftContent || <Logo />}
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          {rightContent}
          <div className="relative" ref={menuRef}>
            <Button
              variant="ghost"
              size="icon"
              className="w-8 h-8 p-2 rounded-sm transition-transform duration-200 ease-in-out hover:scale-110"
              onClick={() => setOpen((v) => !v)}
            >
              <Menu className="h-4 w-4" />
              <span className="sr-only">Navigate</span>
            </Button>
            {open && (
              <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border bg-popover p-1 shadow-lg animate-in fade-in-0 zoom-in-95 slide-in-from-top-2">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.to}
                      onClick={() => {
                        setOpen(false);
                        navigate({ to: item.to });
                      }}
                      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <ModeToggle />
        </div>
      </div>
    </header>
  );
}

export default Navbar;
