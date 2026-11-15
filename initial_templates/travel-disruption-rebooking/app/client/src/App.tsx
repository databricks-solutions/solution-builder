/**
 * Top-level router + layout.
 *
 * Each route maps to one "section" of the demo — see the folder names:
 *   home/       — the narrative landing page
 *   chat/       — the Assistant (conversations + streaming + thinking panel)
 *   irops/      — disrupted flights, flight workbench (re-accommodation plan), Duty Manager approvals
 *   analytics/  — warehouse-backed charts
 *   dashboard/  — embedded AI/BI dashboard iframe
 *
 * Chrome (sidebar + header) lives in shell/.
 */
import { createBrowserRouter, RouterProvider, Outlet } from 'react-router';
import { SidebarInset, SidebarProvider } from '@databricks/appkit-ui/react';

import { AppSidebar } from '@/shell/AppSidebar';
import { AppHeader } from '@/shell/AppHeader';
import { HomeView } from '@/home/HomeView';
import { ChatView } from '@/chat/ChatView';
import { ChatDock } from '@/chat/ChatDock';
import { FlightsView } from '@/irops/FlightsView';
import { FlightWorkbench } from '@/irops/FlightWorkbench';
import { ApprovalsView } from '@/irops/ApprovalsView';
import { AnalyticsView } from '@/analytics/AnalyticsView';
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
        { path: '/', element: <HomeView /> },
        { path: '/c/:id', element: <ChatView /> },
        { path: '/flights', element: <FlightsView /> },
        { path: '/flights/:id', element: <FlightWorkbench /> },
        { path: '/approvals', element: <ApprovalsView /> },
        { path: '/analytics', element: <AnalyticsView /> },
        { path: '/dashboard', element: <DashboardView /> },
      ],
    },
  ],
  PREVIEW_BASENAME ? { basename: PREVIEW_BASENAME } : undefined,
);

export default function App() {
  return <RouterProvider router={router} />;
}
