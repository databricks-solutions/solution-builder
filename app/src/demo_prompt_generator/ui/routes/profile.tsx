import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { AppLayout } from "@/components/layout/app-layout";
import {
  getCurrentUser,
  getConfigStatus,
  type CurrentUser,
  type ConfigStatus,
} from "@/lib/custom-api";
import {
  Shield,
  Database,
  Loader2,
  CheckCircle2,
  XCircle,
  User,
} from "lucide-react";

function ProfileWithLayout() {
  return <AppLayout><ProfilePage /></AppLayout>;
}

export const Route = createFileRoute("/profile")({
  component: ProfileWithLayout,
});

/** Derive initials from an email address. */
function getInitials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[.\-_]/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

function ProfilePage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([getCurrentUser(), getConfigStatus()])
      .then(([userData, configData]) => {
        setUser(userData);
        setConfig(configData);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const memberSince = config?.current_user?.created_at
    ? new Date(config.current_user.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <User className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Profile</h1>
          <p className="text-sm text-muted-foreground">
            Your account and connection details
          </p>
        </div>
      </div>

      {/* ---------- User Profile Card ---------- */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-4 space-y-0">
          <Avatar className="h-14 w-14">
            <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
              {user ? getInitials(user.email) : "??"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-xl">
                {user?.user_name ?? user?.email ?? "Unknown User"}
              </CardTitle>
              {user?.is_template_admin && (
                <Badge
                  variant="secondary"
                  className="gap-1 text-xs font-medium"
                >
                  <Shield className="h-3 w-3" />
                  Template Admin
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="font-medium">{user?.email ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Username</dt>
              <dd className="font-medium">{user?.user_name ?? "-"}</dd>
            </div>
            {memberSince && (
              <div>
                <dt className="text-muted-foreground">Member Since</dt>
                <dd className="font-medium">{memberSince}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* ---------- Database Status Card ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-muted-foreground" />
            Database Status
          </CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Connection Type</dt>
              <dd className="font-medium capitalize">
                {config?.database.type ?? "-"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="flex items-center gap-1.5 font-medium">
                {config?.database.connected ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    Connected
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-destructive" />
                    Disconnected
                  </>
                )}
              </dd>
            </div>
            {config?.database.error && (
              <div className="col-span-2">
                <dt className="text-muted-foreground">Error</dt>
                <dd className="text-destructive text-xs mt-0.5">
                  {config.database.error}
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
