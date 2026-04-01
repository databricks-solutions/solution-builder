import SidebarLayout from "@/components/apx/sidebar-layout";
import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { User, History, Sparkles, Map, Library } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export const Route = createFileRoute("/_sidebar")({
  component: () => <Layout />,
});

function Layout() {
  const location = useLocation();

  const navItems = [
    {
      to: "/",
      label: "New Skill",
      icon: <Sparkles size={16} />,
      match: (path: string) => path === "/" || path.startsWith("/workspace"),
    },
    {
      to: "/library",
      label: "Library",
      icon: <Library size={16} />,
      match: (path: string) => path.startsWith("/library"),
    },
    {
      to: "/generations",
      label: "Generations",
      icon: <History size={16} />,
      match: (path: string) => path.startsWith("/generations"),
    },
    {
      to: "/plan",
      label: "Plan",
      icon: <Map size={16} />,
      match: (path: string) => path === "/plan",
    },
    {
      to: "/profile",
      label: "Profile",
      icon: <User size={16} />,
      match: (path: string) => path === "/profile",
    },
  ];

  return (
    <SidebarLayout>
      <SidebarGroup>
        <SidebarGroupLabel className="text-xs text-muted-foreground px-3">Navigate</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {navItems.map((item) => {
              const active = item.match(location.pathname);
              return (
                <SidebarMenuItem key={item.to}>
                  <Link
                    to={item.to}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <span className={active ? "text-primary" : ""}>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarLayout>
  );
}
