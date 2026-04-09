import { ModeToggle } from "@/components/layout/mode-toggle";
import Logo from "@/components/layout/logo";
import { Link } from "@tanstack/react-router";
import { Library } from "lucide-react";
import { ReactNode } from "react";

interface NavbarProps {
  leftContent?: ReactNode;
  rightContent?: ReactNode;
}

export function Navbar({ leftContent, rightContent }: NavbarProps) {
  return (
    <header className="z-50 bg-background/80 backdrop-blur-sm border-b border-border/80">
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="h-14 flex items-center justify-between px-4">
        <div className="flex items-center gap-6">
          {leftContent || <Logo />}
          <Link
            to="/templates"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Library className="h-4 w-4" />
            Explore Templates
          </Link>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          {rightContent}
          <ModeToggle />
        </div>
      </div>
    </header>
  );
}

export default Navbar;
