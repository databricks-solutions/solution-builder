import { useEffect } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import { reportClientError } from './lib/devErrorReporter';

/**
 * Attached as `errorElement` on the root layout route so route-level throws
 * (404s, loader failures, lazy-module load errors) render our UI instead of
 * React Router's default "Hey developer 👋" fallback — and also beacon to
 * the server in dev.
 */
export function RouteError() {
  const error = useRouteError();

  useEffect(() => {
    if (isRouteErrorResponse(error)) {
      reportClientError(
        { message: `${error.status} ${error.statusText}`, stack: JSON.stringify(error.data) },
        'boundary',
      );
    } else {
      reportClientError(error, 'boundary');
    }
  }, [error]);

  const title = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : 'Application Error';
  const message = isRouteErrorResponse(error)
    ? typeof error.data === 'string'
      ? error.data
      : JSON.stringify(error.data, null, 2)
    : (error as Error | undefined)?.message ?? String(error);
  // Stack leaks source-map paths + internal file names — dev-only.
  const stack = import.meta.env.DEV
    ? (error as Error | undefined)?.stack
    : undefined;

  return (
    <div className="min-h-screen bg-background p-4">
      <Card className="max-w-2xl mx-auto mt-8">
        <CardHeader>
          <CardTitle className="text-destructive">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Details:</h3>
              <pre className="bg-muted p-3 rounded text-sm overflow-auto">{message}</pre>
            </div>
            {stack && (
              <div>
                <h3 className="font-semibold mb-2">Stack:</h3>
                <pre className="bg-muted p-3 rounded text-sm overflow-auto max-h-96">{stack}</pre>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
