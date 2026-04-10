/**
 * Setup/configuration page shown on first launch.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ConfigCheck } from "@/components/config/config-check";

export const Route = createFileRoute("/setup")({
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();

  const handleComplete = () => {
    // Navigate to main page after setup is complete
    navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen bg-background">
      <ConfigCheck isInitialSetup={true} onComplete={handleComplete} />
    </div>
  );
}
