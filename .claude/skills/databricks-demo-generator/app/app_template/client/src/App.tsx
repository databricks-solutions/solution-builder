/**
 * Top-level router + layout.
 *
 * Each route maps to one "section" of the demo — see the folder names:
 *   home/       — the narrative landing page
 *   chat/       — the Assistant (conversations + streaming + thinking panel)
 *   operations/ — OLTP workflow (returns queue, lot cards, decision drawer)
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
import { OperationsView } from '@/operations/OperationsView';
import { AnalyticsView } from '@/analytics/AnalyticsView';
import { DashboardView } from '@/dashboard/DashboardView';

function Layout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        <div className="flex-1 min-h-0">
          <Outlet />
        </div>
      </SidebarInset>
      <ChatDock />
    </SidebarProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomeView /> },
      { path: '/c/:id', element: <ChatView /> },
      { path: '/operations', element: <OperationsView /> },
      { path: '/analytics', element: <AnalyticsView /> },
      { path: '/dashboard', element: <DashboardView /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
