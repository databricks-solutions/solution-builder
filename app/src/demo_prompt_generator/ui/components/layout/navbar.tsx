import { ModeToggle } from "@/components/layout/mode-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import Logo from "@/components/layout/logo";
import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { Menu, Home, FolderOpen, Library, User, Info, HelpCircle } from "lucide-react";
import { useGuide } from "@/components/guide/guide-modal";
import { ReactNode } from "react";
import { IS_ELECTRON } from "@/lib/config";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const navLinks = [
  { to: "/" as const, label: "Home", icon: Home },
  { to: "/projects" as const, label: "Projects", icon: FolderOpen },
  { to: "/templates" as const, label: "Templates", icon: Library },
  { to: "/about" as const, label: "About", icon: Info },
];

interface NavbarProps {
  leftContent?: ReactNode;
  rightContent?: ReactNode;
  /** Hide inline nav links (e.g. on home page where they'd be redundant) */
  hideNav?: boolean;
}

export function Navbar({ leftContent, rightContent, hideNav }: NavbarProps) {
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const { open: openGuide } = useGuide();

  return (
    <header className={`z-50 bg-background/80 backdrop-blur-sm border-b border-border/80 ${IS_ELECTRON ? 'electron-drag' : ''}`} role="banner">
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className={`h-14 flex items-center justify-between px-4 ${IS_ELECTRON ? 'pl-20' : ''}`}>
        <div className="flex items-center gap-6 electron-no-drag">
          {leftContent || <Logo />}

          {/* Inline nav links — visible on md+ */}
          {!hideNav && (
            <nav className="hidden md:flex items-center gap-1" aria-label="Main navigation">
              {navLinks.map((link) => {
                const isActive = link.to === "/"
                  ? !!matchRoute({ to: "/", fuzzy: false })
                  : !!matchRoute({ to: link.to, fuzzy: true });
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <link.icon className="h-3.5 w-3.5" />
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 electron-no-drag">
          {rightContent}
          {/* Hamburger menu — mobile navigation fallback */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="w-8 h-8 md:hidden">
                <Menu className="h-4 w-4" />
                <span className="sr-only">Navigate</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => navigate({ to: "/" })} className="cursor-pointer">
                <Home className="mr-2 h-4 w-4" />
                Home
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate({ to: "/projects" })} className="cursor-pointer">
                <FolderOpen className="mr-2 h-4 w-4" />
                My Projects
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate({ to: "/templates" })} className="cursor-pointer">
                <Library className="mr-2 h-4 w-4" />
                Templates
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate({ to: "/about" })} className="cursor-pointer">
                <Info className="mr-2 h-4 w-4" />
                About
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate({ to: "/profile" })} className="cursor-pointer">
                <User className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            className="w-8 h-8"
            onClick={openGuide}
            aria-label="Open guide"
            title="Open guide"
          >
            <HelpCircle className="h-4 w-4" />
          </Button>
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

export default Navbar;
