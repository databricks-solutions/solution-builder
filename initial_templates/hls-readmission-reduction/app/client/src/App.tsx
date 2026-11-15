/**
 * Top-level router + layout.
 *
 * Each route maps to one "section" of the demo — see the folder names:
 *   care/       — command center (home), discharge worklist + transition plans, HRRP exposure, outreach queue
 *   chat/       — the Assistant (conversations + streaming + thinking panel)
 *   analytics/  — warehouse-backed charts
 *   dashboard/  — embedded AI/BI dashboard iframe
 *
 * Chrome (sidebar + header) lives in shell/.
 */
import { createBrowserRouter, RouterProvider, Outlet } from 'react-router';
import { SidebarInset, SidebarProvider } from '@databricks/appkit-ui/react';

import { AppSidebar } from '@/shell/AppSidebar';
import { AppHeader } from '@/shell/AppHeader';
import { CommandCenter } from '@/care/CommandCenter';
import { ChatView } from '@/chat/ChatView';
import { ChatDock } from '@/chat/ChatDock';
import { WorklistView } from '@/care/WorklistView';
import { HrrpView } from '@/care/HrrpView';
import { OutreachView } from '@/care/OutreachView';
import { AnalyticsView } from '@/analytics/AnalyticsView';
import { DashboardView } from '@/dashboard/DashboardView';
import { SessionProvider } from '@/lib/api';
import { RouteError } from './RouteError';

function Layout() {
  // SessionProvider wraps everything so /api/me and /api/config are
  // fetched ONCE here and consumed via `useSession()` by AppHeader,
  // AppSidebar, CommandCenter, ChatDock, ChatView, WorklistView, etc.
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
        { path: '/', element: <CommandCenter /> },
        { path: '/c/:id', element: <ChatView /> },
        { path: '/worklist', element: <WorklistView /> },
        { path: '/worklist/:id', element: <WorklistView /> },
        { path: '/hrrp', element: <HrrpView /> },
        { path: '/outreach', element: <OutreachView /> },
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
