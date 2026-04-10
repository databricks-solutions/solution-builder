import { ModeToggle } from "@/components/layout/mode-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import Logo from "@/components/layout/logo";
import { Link } from "@tanstack/react-router";
import { Library } from "lucide-react";
import { ReactNode } from "react";
import { IS_ELECTRON } from "@/lib/config";

interface NavbarProps {
  leftContent?: ReactNode;
  rightContent?: ReactNode;
}

export function Navbar({ leftContent, rightContent }: NavbarProps) {
  return (
    <header className={`z-50 bg-background/80 backdrop-blur-sm border-b border-border/80 ${IS_ELECTRON ? 'electron-drag' : ''}`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className={`h-14 flex items-center justify-between px-4 ${IS_ELECTRON ? 'pl-20' : ''}`}>
        <div className="flex items-center gap-6 electron-no-drag">
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
        <div className="flex items-center gap-2 electron-no-drag">
          {rightContent}
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

export default Navbar;
