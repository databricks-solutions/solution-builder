/**
 * User avatar menu with configuration access.
 */

import { useState, useEffect } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Settings } from "lucide-react";
import { ConfigCheck } from "@/components/config/config-check";
import { getConfigStatus, type ConfigUser } from "@/lib/custom-api";

export function UserMenu() {
  const [user, setUser] = useState<ConfigUser | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    loadUser();
  }, []);

  async function loadUser() {
    try {
      const status = await getConfigStatus();
      setUser(status.current_user);
    } catch (err) {
      console.error("Failed to load user:", err);
    }
  }

  // Get initials from email
  const getInitials = (email: string) => {
    const parts = email.split("@")[0].split(/[._-]/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return email.slice(0, 2).toUpperCase();
  };

  if (!user) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="rounded-full cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <Avatar className="h-9 w-9 cursor-pointer hover:opacity-80 transition-opacity">
              <AvatarFallback className="bg-primary text-primary-foreground text-sm font-medium">
                {getInitials(user.email)}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <div className="px-3 py-2">
            <p className="text-sm font-medium">{user.email}</p>
            <p className="text-xs text-muted-foreground">
              Profile: {user.databricks_profile}
            </p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowSettings(true)} className="cursor-pointer">
            <Settings className="mr-2 h-4 w-4" />
            Configuration
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Settings Dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Configuration</DialogTitle>
          </DialogHeader>
          <ConfigCheck
            isInitialSetup={false}
            onComplete={() => {
              setShowSettings(false);
              loadUser(); // Refresh user data
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

export default UserMenu;
