/**
 * Top-level router + layout.
 *
 * Each route maps to one "section" of the demo — see the folder names:
 *   console/    — Live-Ops Console: Season 7 story, KPIs, segment board, segment panel (plan + schedule)
 *   whatif/     — budget what-if (driver-matched plan vs blanket gem sale)
 *   chat/       — the copilot (conversations + streaming + thinking panel)
 *   dashboard/  — embedded live-ops AI/BI dashboard
 *
 * Chrome (sidebar + header) lives in shell/.
 */
import { createBrowserRouter, RouterProvider, Outlet } from 'react-router';
import { SidebarInset, SidebarProvider } from '@databricks/appkit-ui/react';

import { AppSidebar } from '@/shell/AppSidebar';
import { AppHeader } from '@/shell/AppHeader';
import { ConsoleView } from '@/console/ConsoleView';
import { WhatIfView } from '@/whatif/WhatIfView';
import { ChatView } from '@/chat/ChatView';
import { ChatDock } from '@/chat/ChatDock';
import { DashboardView } from '@/dashboard/DashboardView';
import { SessionProvider } from '@/lib/api';
import { RouteError } from './RouteError';

function Layout() {
  // SessionProvider wraps everything so /api/me and /api/config are
  // fetched ONCE here and consumed via `useSession()` by AppHeader,
  // AppSidebar, HomeView, ChatDock, ChatView, OperationsView, etc.
  // (Previously each component fetched independently — 8-10 redundant
  // requests on every page load.)
  return (
    <SessionProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <AppHeader />
          {/* pb-28: the floating Ask button sits over the bottom of every page. */}
          <div className="flex-1 min-h-0 pb-28">
            <Outlet />
          </div>
        </SidebarInset>
        <ChatDock />
      </SidebarProvider>
    </SessionProvider>
  );
}

// When this app runs inside the Demo Prompt Generator's preview proxy, a
// client-side shim publishes `window.__PREVIEW_BASENAME__` (e.g.
// "/preview/<project-id>"). Passing it as `basename` tells react-router to
// strip that prefix before matching routes. Outside the proxy it's undefined
// and the router behaves normally.
declare global {
  interface Window {
    __PREVIEW_BASENAME__?: string;
  }
}
const PREVIEW_BASENAME =
  typeof window !== 'undefined' ? window.__PREVIEW_BASENAME__ : undefined;

const router = createBrowserRouter(
  [
    {
      element: <Layout />,
      errorElement: <RouteError />,
      children: [
        { path: '/', element: <ConsoleView /> },
        { path: '/c/:id', element: <ChatView /> },
        { path: '/whatif', element: <WhatIfView /> },
        { path: '/dashboard', element: <DashboardView /> },
      ],
    },
  ],
  PREVIEW_BASENAME ? { basename: PREVIEW_BASENAME } : undefined,
);

export default function App() {
  return <RouterProvider router={router} />;
}
