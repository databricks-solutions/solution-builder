import { useState } from 'react';
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
  useSidebar,
} from '@databricks/appkit-ui/react';
import { Spinner } from '@databricks/appkit-ui/react';
import { BarChart3, LayoutDashboard, MessagesSquare, PackageOpen, Plus, Trash2 } from 'lucide-react';
import { useSession } from '@/lib/api';
import { conversationStore, useConversationList } from '@/lib/conversations';

const navItems = [
  { to: '/', label: 'Assistant', icon: MessagesSquare, end: true },
  { to: '/operations', label: 'Operations', icon: PackageOpen, end: false },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, end: false },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: false },
];

export function AppSidebar() {
  const { config } = useSession();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { list: convoList } = useConversationList();
  const { isMobile, setOpenMobile } = useSidebar();

  // On phone the sidebar opens as a full-height overlay; collapse it after
  // any nav so the user lands on the destination, not a covered screen.
  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  async function newChat() {
    if (creating) return;
    setCreating(true);
    try {
      const c = await conversationStore.create();
      navigate(`/c/${c.id}`);
      closeOnMobile();
    } finally {
      setCreating(false);
    }
  }

  async function deleteConvo(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    await conversationStore.remove(id);
    if (location.pathname === `/c/${id}`) navigate('/');
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <NavLink to="/" onClick={closeOnMobile} className="flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-sidebar-accent transition-colors">
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
          </div>
        </NavLink>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <NavLink to={item.to} end={item.end} onClick={closeOnMobile}>
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

        {/* Standout pitch box — entry to the Databricks Data + AI page. */}
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupContent className="px-2">
            <NavLink to="/platform" className="dx-sidebar-pitch">
              <span className="dx-sidebar-pitch-glow" aria-hidden />
              <span className="dx-sidebar-pitch-icon">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="40 0 30 22"
                  className="size-5"
                  aria-hidden
                >
                  <path
                    d="m 62.064999,8.591 -8.631,4.859 L 44.192,8.258 43.747,8.498 v 3.77 l 9.686999,5.431 8.63,-4.84 v 1.995 l -8.63,4.86 -9.241999,-5.192 -0.445,0.24 v 0.646 l 9.686999,5.432 9.668,-5.432 v -3.769 l -0.445,-0.24 -9.223,5.173 L 44.784,11.732 V 9.736 l 8.649999,4.84 9.668,-5.43 V 5.43 l -0.482,-0.277 -9.186,5.155 -8.204999,-4.582 8.204999,-4.6 6.741,3.787 0.593,-0.332 V 4.119 L 53.433999,0 43.747,5.431 v 0.592 l 9.686999,5.432 8.63,-4.86 z"
                    fill="var(--databricks-red)"
                  />
                </svg>
              </span>
              <span className="dx-sidebar-pitch-text">
                <span className="dx-sidebar-pitch-eyebrow">See how it&apos;s working</span>
                <span className="dx-sidebar-pitch-title">Databricks Data + AI</span>
              </span>
            </NavLink>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Collapsed-mode fallback: icon-only entry to the same route. */}
        <SidebarGroup className="hidden group-data-[collapsible=icon]:block">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <NavLink to="/platform" onClick={closeOnMobile}>
                  {({ isActive }) => (
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip="Databricks Data + AI"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="40 0 30 22"
                        className="size-4"
                        aria-hidden
                      >
                        <path
                          d="m 62.064999,8.591 -8.631,4.859 L 44.192,8.258 43.747,8.498 v 3.77 l 9.686999,5.431 8.63,-4.84 v 1.995 l -8.63,4.86 -9.241999,-5.192 -0.445,0.24 v 0.646 l 9.686999,5.432 9.668,-5.432 v -3.769 l -0.445,-0.24 -9.223,5.173 L 44.784,11.732 V 9.736 l 8.649999,4.84 9.668,-5.43 V 5.43 l -0.482,-0.277 -9.186,5.155 -8.204999,-4.582 8.204999,-4.6 6.741,3.787 0.593,-0.332 V 4.119 L 53.433999,0 43.747,5.431 v 0.592 l 9.686999,5.432 8.63,-4.86 z"
                          fill="var(--databricks-red)"
                        />
                      </svg>
                      <span>Databricks Data + AI</span>
                    </SidebarMenuButton>
                  )}
                </NavLink>
              </SidebarMenuItem>
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
                <SidebarMenuItem key={c.id} className="group/convo">
                  <NavLink to={`/c/${c.id}`} onClick={closeOnMobile}>
                    {({ isActive }) => (
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={c.title}
                        className="text-sm pr-7"
                      >
                        <MessagesSquare className="size-4 shrink-0" />
                        <span className="truncate">{c.title}</span>
                      </SidebarMenuButton>
                    )}
                  </NavLink>
                  <button
                    onClick={(e) => deleteConvo(e, c.id)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-sidebar-accent opacity-0 group-hover/convo:opacity-100 transition-opacity"
                    aria-label="Delete conversation"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
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
