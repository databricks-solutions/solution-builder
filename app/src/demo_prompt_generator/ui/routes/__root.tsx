import { ThemeProvider } from "@/components/layout/theme-provider";
import { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { Toaster } from "sonner";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: () => (
    <ThemeProvider defaultTheme="light" storageKey="ui-theme">
      <Outlet />
      <Toaster richColors />
    </ThemeProvider>
  ),
});
