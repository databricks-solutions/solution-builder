import { Link, useMatchRoute } from "@tanstack/react-router";
import Navbar from "@/components/layout/navbar";
import { FolderOpen, User, Library, Info, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

const sidebarLinks = [
  { to: "/" as const, label: "Home", icon: Home },
  { to: "/projects" as const, label: "My Projects", icon: FolderOpen },
  { to: "/templates" as const, label: "Templates", icon: Library },
  { to: "/about" as const, label: "About", icon: Info },
  { to: "/profile" as const, label: "Profile", icon: User },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const matchRoute = useMatchRoute();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar hideNav />
      <div className="flex flex-1">
        {/* Sidebar (hidden on mobile, shown on md+) */}
        <aside className="hidden md:block w-60 shrink-0 border-r border-border/80 bg-muted/30">
          <nav className="sticky top-0 space-y-1 p-4" aria-label="Main navigation">
            {sidebarLinks.map((link) => {
              const isActive = link.to === "/"
                ? !!matchRoute({ to: "/", fuzzy: false })
                : !!matchRoute({ to: link.to, fuzzy: true });
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <link.icon className="h-4 w-4" />
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
