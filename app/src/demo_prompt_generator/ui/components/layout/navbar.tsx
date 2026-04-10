import { ModeToggle } from "@/components/layout/mode-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import Logo from "@/components/layout/logo";
import { useNavigate } from "@tanstack/react-router";
import { Menu, Home, FolderOpen, Library, User, BookOpen } from "lucide-react";
import { ReactNode } from "react";
import { IS_ELECTRON } from "@/lib/config";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NavbarProps {
  leftContent?: ReactNode;
  rightContent?: ReactNode;
}

export function Navbar({ leftContent, rightContent }: NavbarProps) {
  const navigate = useNavigate();

  return (
    <header className={`z-50 bg-background/80 backdrop-blur-sm border-b border-border/80 ${IS_ELECTRON ? 'electron-drag' : ''}`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className={`h-14 flex items-center justify-between px-4 ${IS_ELECTRON ? 'pl-20' : ''}`}>
        <div className="flex items-center gap-6 electron-no-drag">
          {leftContent || <Logo />}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 electron-no-drag">
          {rightContent}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="w-8 h-8">
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
              <DropdownMenuItem onClick={() => navigate({ to: "/gallery" })} className="cursor-pointer">
                <Library className="mr-2 h-4 w-4" />
                Template Gallery
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate({ to: "/profile" })} className="cursor-pointer">
                <User className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate({ to: "/docs" })} className="cursor-pointer">
                <BookOpen className="mr-2 h-4 w-4" />
                Documentation
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

export default Navbar;
