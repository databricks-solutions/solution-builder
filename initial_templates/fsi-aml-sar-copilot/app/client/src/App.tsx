import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from '@/shell/Layout';
import { QueueView } from '@/queue/QueueView';
import { CaseView } from '@/case/CaseView';
import { NetworkView, NetworksList } from '@/network/NetworkView';
import { DecisionsView } from '@/ops/DecisionsView';
import { DashboardView } from '@/ops/DashboardView';
import { RouteError } from './RouteError';

declare global {
  interface Window { __PREVIEW_BASENAME__?: string }
}
const PREVIEW_BASENAME = typeof window !== 'undefined' ? window.__PREVIEW_BASENAME__ : undefined;

const router = createBrowserRouter(
  [{
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <QueueView /> },
      { path: '/case/:alertId', element: <CaseView /> },
      { path: '/networks', element: <NetworksList /> },
      { path: '/network/:clusterId', element: <NetworkView /> },
      { path: '/decisions', element: <DecisionsView /> },
      { path: '/dashboard', element: <DashboardView /> },
    ],
  }],
  PREVIEW_BASENAME ? { basename: PREVIEW_BASENAME } : undefined,
);

export default function App() {
  return <RouterProvider router={router} />;
}
