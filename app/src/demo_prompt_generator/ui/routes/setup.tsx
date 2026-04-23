/**
 * Setup/configuration page shown on first launch in local mode.
 *
 * In deployed mode (Databricks Apps), identity comes from request headers
 * and there is nothing for the user to configure — this route redirects
 * to home. See backend/AUTH.md.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ConfigCheck } from "@/components/config/config-check";
import { getMe, type WhoAmI } from "@/lib/custom-api";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/setup")({
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const [me, setMe] = useState<WhoAmI | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch((err) => {
        console.error("Failed to load identity:", err);
        setLoadError(true);
      });
  }, []);

  useEffect(() => {
    // In deployed mode there's nothing to set up — the header is the auth.
    if (me?.mode === "deployed") {
      navigate({ to: "/" });
    }
  }, [me, navigate]);

  const handleComplete = () => navigate({ to: "/" });

  // Block on the identity fetch so we don't flash the local setup wizard
  // to a deployed-mode user before redirecting them away.
  if (!me && !loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <ConfigCheck isInitialSetup={true} onComplete={handleComplete} />
    </div>
  );
}
