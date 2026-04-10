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
  getDatabricksProfiles,
  type CurrentUser,
  type ConfigStatus,
  type DatabricksProfile,
} from "@/lib/custom-api";
import {
  User,
  Shield,
  Database,
  Globe,
  Loader2,
  CheckCircle2,
  XCircle,
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
  const [profiles, setProfiles] = useState<DatabricksProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([getCurrentUser(), getConfigStatus(), getDatabricksProfiles()])
      .then(([userData, configData, profilesData]) => {
        setUser(userData);
        setConfig(configData);
        setProfiles(profilesData);
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

  const activeProfile = config?.current_user?.databricks_profile ?? null;
  const activeHost =
    profiles.find((p) => p.name === activeProfile)?.host ?? null;
  const memberSince = config?.current_user?.created_at
    ? new Date(config.current_user.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
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

      {/* ---------- Workspace Connection Card ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4 text-muted-foreground" />
            Workspace Connection
          </CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4 space-y-4">
          {/* Active connection summary */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                {activeProfile ?? "No profile selected"}
              </p>
              {activeHost && (
                <p className="text-xs text-muted-foreground break-all">
                  {activeHost}
                </p>
              )}
            </div>
            {activeProfile ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-green-600">
                <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                Connected
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />
                Not connected
              </span>
            )}
          </div>

          {/* Available profiles */}
          {profiles.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Available Profiles
                </p>
                <ul className="space-y-2">
                  {profiles.map((profile) => (
                    <li
                      key={profile.name}
                      className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                    >
                      <div className="space-y-0.5">
                        <span className="font-medium">{profile.name}</span>
                        {profile.host && (
                          <p className="text-xs text-muted-foreground break-all">
                            {profile.host}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {profile.is_default && (
                          <Badge variant="outline" className="text-[10px]">
                            Default
                          </Badge>
                        )}
                        {profile.name === activeProfile && (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
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
