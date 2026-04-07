import { ModeToggle } from "@/components/apx/mode-toggle";
import Logo from "@/components/apx/logo";
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
        {leftContent || <Logo />}
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
