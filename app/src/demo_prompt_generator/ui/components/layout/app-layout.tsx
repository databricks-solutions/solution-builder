import { Link, useMatchRoute } from "@tanstack/react-router";
import Navbar from "@/components/layout/navbar";
import { FolderOpen, User, Library, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

const sidebarLinks = [
  { to: "/projects" as const, label: "My Projects", icon: FolderOpen },
  { to: "/profile" as const, label: "Profile", icon: User },
  { to: "/gallery" as const, label: "Template Gallery", icon: Library },
  { to: "/docs" as const, label: "Documentation", icon: BookOpen },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const matchRoute = useMatchRoute();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />
      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="w-60 shrink-0 border-r border-border/80 bg-muted/30">
          <nav className="sticky top-0 space-y-1 p-4">
            {sidebarLinks.map((link) => {
              const isActive = !!matchRoute({ to: link.to, fuzzy: true });
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
