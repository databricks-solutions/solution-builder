/**
 * User avatar menu. Reads identity from /api/me (see backend/AUTH.md),
 * never from getConfigStatus.
 *
 * Local mode: shows initials if configured, or `?` if /setup hasn't run yet.
 * Deployed mode: shows initials from the header email, always configured.
 * The dropdown "Configuration" item always goes to /profile (which is where
 * the profile picker lives).
 */

import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Settings } from "lucide-react";
import { getMe, type WhoAmI } from "@/lib/custom-api";

function getInitials(email: string): string {
  const parts = email.split("@")[0].split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

export function UserMenu() {
  const [me, setMe] = useState<WhoAmI | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch((err) => console.error("Failed to load identity:", err));
  }, []);

  // Always render the avatar — silence here (returning null) was the old
  // bug where a missing DB user row hid the whole menu and stranded the
  // user with no way to reach /setup or /profile.
  const initials = me?.email ? getInitials(me.email) : "?";
  const emailLine = me?.email ?? "Not configured";
  const profileLine =
    me?.mode === "deployed"
      ? "Managed by Databricks Apps"
      : me?.databricks_profile
      ? `Profile: ${me.databricks_profile}`
      : "Finish setup to pick a profile";
  const menuTarget = me?.is_configured ? "/profile" : "/setup";
  const menuLabel = me?.is_configured ? "Configuration" : "Complete setup";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-full cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
          <Avatar className="h-9 w-9 cursor-pointer hover:opacity-80 transition-opacity">
            <AvatarFallback className="bg-primary text-primary-foreground text-sm font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="px-3 py-2">
          <p className="text-sm font-medium">{emailLine}</p>
          <p className="text-xs text-muted-foreground">{profileLine}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => navigate({ to: menuTarget })}
          className="cursor-pointer"
        >
          <Settings className="mr-2 h-4 w-4" />
          {menuLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default UserMenu;
