import { useEffect, useState } from 'react';
import { ExternalLink, MessageSquareText } from 'lucide-react';
import { getJson, type Json } from '@/lib/api';

export function DashboardView() {
  const [cfg, setCfg] = useState<Json | null>(null);
  useEffect(() => { getJson('/api/config').then(setCfg); }, []);
  if (!cfg) return null;
  const dash = `${cfg.host}/dashboardsv3/${cfg.dashboardId}/published`;
  const genie = `${cfg.host}/genie/rooms/${cfg.genieSpaceId}`;
  return (
    <div className="px-8 py-6 space-y-4 h-full flex flex-col">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <h1 className="font-display text-3xl">Compliance dashboard</h1>
          <p className="text-sm text-muted-foreground">For the Head of Financial Crimes Compliance: alert volumes, false-positive rate, SAR filing SLA and the ML re-ranking — plus Genie for follow-up questions in plain English.</p>
        </div>
        <a href={dash} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md bg-[#0B2545] px-3 py-2 text-sm text-white"><ExternalLink className="h-4 w-4" /> Open AI/BI dashboard</a>
        {cfg.genieSpaceId && <a href={genie} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm"><MessageSquareText className="h-4 w-4" /> Ask Genie</a>}
      </div>
      {cfg.dashboardId ? (
        <iframe title="Compliance dashboard" src={`${cfg.host}/embed/dashboardsv3/${cfg.dashboardId}`} className="flex-1 min-h-[720px] w-full rounded-xl border bg-card" />
      ) : <div className="text-sm text-muted-foreground">DASHBOARD_ID not configured.</div>}
    </div>
  );
}
