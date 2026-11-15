import { NavLink, Outlet, useNavigate } from 'react-router';
import { ListOrdered, Network, ScrollText, LayoutDashboard, RotateCcw, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getJson, postJson, type Json } from '@/lib/api';

export const ConfigContext = { current: null as Json | null };

const NAV = [
  { to: '/', label: 'Alert queue', icon: ListOrdered, end: true },
  { to: '/networks', label: 'Entity networks', icon: Network },
  { to: '/decisions', label: 'Decisions & audit', icon: ScrollText },
  { to: '/dashboard', label: 'Compliance dashboard', icon: LayoutDashboard },
];

export function Layout() {
  const [cfg, setCfg] = useState<Json | null>(null);
  const [resetting, setResetting] = useState(false);
  const nav = useNavigate();
  useEffect(() => {
    getJson('/api/config').then((c) => { ConfigContext.current = c; setCfg(c); }).catch(() => undefined);
  }, []);
  async function resetDemo() {
    if (!window.confirm('Reset the demo? This clears every decision, audit entry and SAR draft; all alerts go back to open.')) return;
    setResetting(true);
    try {
      await postJson('/api/admin/reset', {});
      nav('/');
      window.location.reload();
    } finally {
      setResetting(false);
    }
  }
  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="w-60 shrink-0 bg-[#0B2545] text-white flex flex-col">
        <div className="px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-[#F2C14E]" />
            <div>
              <div className="font-display text-lg leading-tight">Northwind Federal</div>
              <div className="text-[11px] uppercase tracking-widest text-white/60">Financial Intelligence Unit</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${isActive ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
              <n.icon className="h-4 w-4" /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-white/10 text-[11px] text-white/55 space-y-1">
          <button onClick={resetDemo} disabled={resetting} data-testid="reset-demo"
            className="mb-2 inline-flex w-full items-center justify-center gap-2 rounded-md border border-white/25 px-3 py-1.5 text-xs text-white hover:bg-white/10 disabled:opacity-50">
            <RotateCcw className="h-3.5 w-3.5" /> {resetting ? 'Resetting…' : 'Reset demo'}
          </button>
          <div>AML Investigator Copilot</div>
          {cfg && <div className="font-mono break-all">{cfg.catalog}.{cfg.schema}</div>}
          {cfg && <div className="truncate">Signed in: {cfg.user}</div>}
        </div>
      </aside>
      {/* pb-28: same bottom clearance as the other apps' page wrapper. */}
      <main className="flex-1 min-w-0 overflow-y-auto pb-28">
        <Outlet />
      </main>
    </div>
  );
}
