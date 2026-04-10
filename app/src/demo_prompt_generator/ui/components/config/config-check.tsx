/**
 * Configuration check component.
 *
 * Shows:
 * 1. Database connection status (local/remote)
 * 2. Databricks profile selection and connection test
 * 3. User email (auto-detected from Databricks)
 *
 * Used on first launch and accessible from user menu.
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  XCircle,
  Database,
  Cloud,
  HardDrive,
  Loader2,
  RefreshCw,
  User,
  Settings2,
  Download,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import {
  getConfigStatus,
  testDatabricksConnection,
  saveUserConfig,
  type ConfigStatus,
  type DatabricksConnectionStatus,
} from "@/lib/custom-api";
import type { UpdateStatus } from "@/types/electron";

interface ConfigCheckProps {
  /** Whether this is the initial setup (full screen) or settings view */
  isInitialSetup?: boolean;
  /** Callback when configuration is complete */
  onComplete?: () => void;
}

export function ConfigCheck({ isInitialSetup = false, onComplete }: ConfigCheckProps) {
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Databricks connection state
  const [selectedProfile, setSelectedProfile] = useState<string>("DEFAULT");
  const [connectionStatus, setConnectionStatus] = useState<DatabricksConnectionStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  // Update state (Electron only)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const isElectron = typeof window !== "undefined" && window.electronAPI?.isElectron;

  // Load config status on mount
  useEffect(() => {
    loadConfigStatus();
  }, []);

  // Set up update status listener (Electron only)
  useEffect(() => {
    if (!isElectron) return;

    // Get initial update status
    window.electronAPI?.getUpdateStatus().then(setUpdateStatus);

    // Listen for update status changes
    const cleanup = window.electronAPI?.onUpdateStatus(setUpdateStatus);
    return cleanup;
  }, [isElectron]);

  async function checkForUpdates() {
    if (!isElectron) return;
    try {
      const status = await window.electronAPI?.checkForUpdates();
      if (status) setUpdateStatus(status);
    } catch (err) {
      console.error("Failed to check for updates:", err);
    }
  }

  async function downloadUpdate() {
    if (!isElectron) return;
    try {
      await window.electronAPI?.downloadUpdate();
    } catch (err) {
      console.error("Failed to download update:", err);
    }
  }

  async function installUpdate() {
    if (!isElectron) return;
    try {
      await window.electronAPI?.installUpdate();
    } catch (err) {
      console.error("Failed to install update:", err);
    }
  }

  async function loadConfigStatus() {
    setLoading(true);
    setError(null);
    try {
      const status = await getConfigStatus();
      setConfigStatus(status);

      // Set default profile from current user or first available, then auto-test
      let profileToSelect: string | null = null;
      if (status.current_user) {
        profileToSelect = status.current_user.databricks_profile;
      } else if (status.databricks_profiles.length > 0) {
        const defaultProfile = status.databricks_profiles.find((p) => p.is_default);
        profileToSelect = defaultProfile?.name || status.databricks_profiles[0].name;
      }

      if (profileToSelect) {
        setSelectedProfile(profileToSelect);
        // Auto-test the connection for the initial profile
        testConnection(profileToSelect);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load configuration");
    } finally {
      setLoading(false);
    }
  }

  async function testConnection(profile?: string) {
    const profileToTest = profile || selectedProfile;
    setTesting(true);
    setConnectionStatus(null);
    try {
      const status = await testDatabricksConnection(profileToTest);
      setConnectionStatus(status);
    } catch (err) {
      setConnectionStatus({
        connected: false,
        profile: profileToTest,
        host: null,
        user_email: null,
        error: err instanceof Error ? err.message : "Connection failed",
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleSaveAndContinue() {
    if (!connectionStatus?.connected || !connectionStatus.user_email) {
      return;
    }

    setSaving(true);
    try {
      await saveUserConfig(selectedProfile);
      // Refresh status to get updated user
      await loadConfigStatus();
      onComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save configuration");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Checking your configuration, please wait...</p>
      </div>
    );
  }

  if (error && !configStatus) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <XCircle className="h-12 w-12 text-destructive" />
        <p className="text-destructive">{error}</p>
        <Button onClick={loadConfigStatus} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  const isConfigured = connectionStatus?.connected && connectionStatus.user_email;

  return (
    <div className={isInitialSetup ? "min-h-screen flex items-center justify-center p-8" : ""}>
      <div className={`space-y-6 ${isInitialSetup ? "max-w-xl w-full" : ""}`}>
        {isInitialSetup && (
          <div className="text-center space-y-2 mb-8">
            <Settings2 className="h-12 w-12 mx-auto text-primary" />
            <h1 className="text-2xl font-bold">Configuration</h1>
            <p className="text-muted-foreground">
              Let's verify your connection to get started
            </p>
          </div>
        )}

        {/* Update Status (Electron only) */}
        {isElectron && updateStatus && (
          <Card className={updateStatus.available ? "border-primary" : ""}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5" />
                App Updates
              </CardTitle>
              {updateStatus.currentVersion && (
                <CardDescription>
                  Current version: {updateStatus.currentVersion}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {/* Checking for updates */}
              {updateStatus.checking && (
                <div className="flex items-center gap-3 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Checking for updates...</span>
                </div>
              )}

              {/* Update available */}
              {updateStatus.available && !updateStatus.downloaded && !updateStatus.downloading && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10 border border-primary/20">
                    <div>
                      <p className="font-medium text-primary">
                        New version available: {updateStatus.newVersion}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Click download to get the latest features
                      </p>
                    </div>
                    <Button onClick={downloadUpdate} size="sm">
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
                  </div>
                </div>
              )}

              {/* Downloading */}
              {updateStatus.downloading && updateStatus.progress && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <span>Downloading update...</span>
                  </div>
                  <Progress value={updateStatus.progress.percent} className="h-2" />
                  <p className="text-sm text-muted-foreground text-right">
                    {updateStatus.progress.percent.toFixed(0)}%
                  </p>
                </div>
              )}

              {/* Downloaded, ready to install */}
              {updateStatus.downloaded && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-green-50 border border-green-200 dark:bg-green-950/20 dark:border-green-800">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                      <div>
                        <p className="font-medium text-green-800 dark:text-green-200">
                          Update ready to install
                        </p>
                        <p className="text-sm text-green-600 dark:text-green-400">
                          Restart the app to apply the update
                        </p>
                      </div>
                    </div>
                    <Button onClick={installUpdate} size="sm" variant="default">
                      Restart
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </div>
                </div>
              )}

              {/* No update available */}
              {!updateStatus.checking && !updateStatus.available && !updateStatus.error && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span>You're on the latest version</span>
                  </div>
                  <Button onClick={checkForUpdates} variant="ghost" size="sm">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Check
                  </Button>
                </div>
              )}

              {/* Error */}
              {updateStatus.error && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-destructive">
                    <XCircle className="h-5 w-5" />
                    <span className="text-sm">{updateStatus.error}</span>
                  </div>
                  <Button onClick={checkForUpdates} variant="ghost" size="sm">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Retry
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Database Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Database className="h-5 w-5" />
              Database
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {configStatus?.database.type === "local" ? (
                  <HardDrive className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <Cloud className="h-5 w-5 text-primary" />
                )}
                <div>
                  <p className="font-medium">
                    {configStatus?.database.type === "local" ? "Local (PGLite)" : "Remote (Lakebase)"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {configStatus?.database.type === "local"
                      ? "Data stored locally on your machine"
                      : "Connected to Databricks Lakebase"}
                  </p>
                </div>
              </div>
              {configStatus?.database.connected ? (
                <CheckCircle2 className="h-6 w-6 text-green-500" />
              ) : (
                <XCircle className="h-6 w-6 text-destructive" />
              )}
            </div>
            {configStatus?.database.error && (
              <p className="text-sm text-destructive mt-2">{configStatus.database.error}</p>
            )}
          </CardContent>
        </Card>

        {/* Databricks Connection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Cloud className="h-5 w-5" />
              Databricks Workspace
            </CardTitle>
            <CardDescription>
              Select your Databricks profile and test the connection
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Profile Selection */}
            <div className="flex gap-3">
              <Select value={selectedProfile} onValueChange={(value) => {
                  setSelectedProfile(value);
                  testConnection(value);
                }}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select profile" />
                </SelectTrigger>
                <SelectContent>
                  {configStatus?.databricks_profiles.map((profile) => (
                    <SelectItem key={profile.name} value={profile.name}>
                      {profile.name}
                      {profile.is_default && " (default)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={() => testConnection()}
                disabled={testing || !selectedProfile}
                variant="outline"
              >
                {testing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Test Connection"
                )}
              </Button>
            </div>

            {/* Connection Status */}
            {connectionStatus && (
              <div
                className={`p-4 rounded-lg border ${
                  connectionStatus.connected
                    ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800"
                    : "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
                }`}
              >
                <div className="flex items-start gap-3">
                  {connectionStatus.connected ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
                  )}
                  <div className="flex-1">
                    {connectionStatus.connected ? (
                      <>
                        <p className="font-medium text-green-800 dark:text-green-200">
                          Connected
                        </p>
                        {connectionStatus.user_email && (
                          <div className="flex items-center gap-2 mt-1 text-sm text-green-700 dark:text-green-300">
                            <User className="h-4 w-4" />
                            {connectionStatus.user_email}
                          </div>
                        )}
                        {connectionStatus.host && (
                          <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                            {connectionStatus.host}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="font-medium text-red-800 dark:text-red-200">
                          Connection Failed
                        </p>
                        <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                          {connectionStatus.error}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Current User Info */}
            {configStatus?.current_user && !connectionStatus && (
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-sm">
                  <span className="text-muted-foreground">Current user:</span>{" "}
                  <span className="font-medium">{configStatus.current_user.email}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Profile: {configStatus.current_user.databricks_profile}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Error message */}
        {error && (
          <p className="text-sm text-destructive text-center">{error}</p>
        )}

        {/* Action buttons */}
        <div className="flex justify-end gap-3">
          {!isInitialSetup && (
            <Button variant="outline" onClick={loadConfigStatus}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          )}
          {isInitialSetup && (
            <Button
              onClick={handleSaveAndContinue}
              disabled={!isConfigured || saving}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Continue"
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ConfigCheck;
