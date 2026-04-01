import { ThemeProvider } from "@/components/apx/theme-provider";
import { BuildoutToast } from "@/components/buildout-toast";
import { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { Toaster } from "sonner";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: () => (
    <ThemeProvider defaultTheme="dark" storageKey="apx-ui-theme">
      <Outlet />
      <Toaster richColors />
      <BuildoutToast />
    </ThemeProvider>
  ),
});
