import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@databricks/appkit-ui/react';
import { Spinner } from '@databricks/appkit-ui/react';
import { BarChart3, LayoutDashboard, MessagesSquare, PackageOpen, Plus } from 'lucide-react';
import { fetchConfig, type AppConfig } from '@/lib/api';
import { conversationStore, useConversationList } from '@/lib/conversations';

const navItems = [
  { to: '/', label: 'Assistant', icon: MessagesSquare, end: true },
  { to: '/operations', label: 'Operations', icon: PackageOpen, end: false },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, end: false },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: false },
];

export function AppSidebar() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { list: convoList } = useConversationList();

  useEffect(() => {
    fetchConfig().then(setConfig).catch(console.error);
  }, []);

  async function newChat() {
    if (creating) return;
    setCreating(true);
    try {
      const c = await conversationStore.create();
      navigate(`/c/${c.id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-2">
          <div
            className="flex aspect-square size-8 items-center justify-center rounded-md text-primary-foreground font-semibold shrink-0"
            style={{ background: 'var(--primary)' }}
          >
            {(config?.branding.appName ?? '•')[0]?.toUpperCase()}
          </div>
          <div className="flex flex-col leading-tight overflow-hidden group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold truncate">
              {config?.branding.appName ?? 'Loading…'}
            </span>
            {config?.hero && (
              <span className="text-xs text-muted-foreground truncate">
                {config.hero.company}
              </span>
            )}
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <NavLink to={item.to} end={item.end}>
                    {({ isActive }) => (
                      <SidebarMenuButton isActive={isActive} tooltip={item.label}>
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    )}
                  </NavLink>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <div className="flex items-center justify-between pr-2 group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Conversations</SidebarGroupLabel>
            <button
              onClick={newChat}
              disabled={creating}
              className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-sidebar-accent transition-colors disabled:opacity-50"
              aria-label="New conversation"
              title="New conversation"
            >
              {creating ? <Spinner /> : <Plus className="size-3.5" />}
            </button>
          </div>
          <SidebarGroupContent>
            <SidebarMenu>
              {convoList.length === 0 && (
                <div className="px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                  No conversations yet.
                </div>
              )}
              {convoList.map((c) => (
                <SidebarMenuItem key={c.id}>
                  <NavLink to={`/c/${c.id}`}>
                    {({ isActive }) => (
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={c.title}
                        className="text-sm"
                      >
                        <MessagesSquare className="size-4 shrink-0" />
                        <span className="truncate">{c.title}</span>
                      </SidebarMenuButton>
                    )}
                  </NavLink>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
