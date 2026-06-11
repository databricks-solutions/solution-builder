/**
 * Right-side drawer with four tabs. Opens when the user clicks a row in
 * the returns table. Auto-refreshes on dataMutated (so when the assistant
 * writes an email or approves a return, this view reflects it live).
 */
import { useEffect, useState } from 'react';
import { Activity, Factory } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@databricks/appkit-ui/react';
import { fetchReturn } from '@/lib/returns';
import { dataMutated } from '@/lib/events';
import { StatusBadge, TierBadge } from '@/shared/badges';
import type { ReturnDetail } from '@/shared/types';

import { ReturnTab } from './tabs/ReturnTab';
import { CustomerTab } from './tabs/CustomerTab';
import { ActivityTab } from './tabs/ActivityTab';

type Props = {
  id: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMutated: () => void;
};

export function ReturnDrawer({ id, open, onOpenChange, onMutated }: Props) {
  const [detail, setDetail] = useState<ReturnDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setDetail(null);
      return;
    }
    setLoading(true);
    fetchReturn(id)
      .then(setDetail)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    const unsub = dataMutated.subscribe(() => {
      if (id) void fetchReturn(id).then(setDetail).catch(() => {});
    });
    return unsub;
  }, [id]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // Phone: full-screen drawer (w-full).
        // Tablet (sm+): 60vw — wide enough to read on iPad.
        // Desktop (lg+): cap at ~640px so it doesn't dominate a 24" screen.
        // !important needed because @databricks/appkit-ui Sheet sets its own
        // default width that wins specificity otherwise.
        className="!w-full sm:!w-[60vw] sm:!max-w-[60vw] lg:!w-[640px] lg:!max-w-[640px] p-0 flex flex-col"
      >
        {!detail && loading && (
          <div className="p-8 text-muted-foreground">Loading…</div>
        )}
        {error && <div className="p-8 text-destructive">{error}</div>}
        {detail && (
          <>
            <SheetHeader className="px-8 pt-8 pb-4 border-b border-border">
              <div className="flex items-center gap-3">
                <StatusBadge status={detail.status} />
                <span className="font-mono text-xs text-muted-foreground">
                  {detail.lot_id ?? '—'}
                </span>
                {detail.facility && (
                  <span className="font-mono text-xs text-muted-foreground inline-flex items-center gap-1">
                    <Factory className="size-3" /> {detail.facility}
                  </span>
                )}
              </div>
              <SheetTitle className="display text-2xl">
                {detail.product_name ?? 'Return'}
              </SheetTitle>
              <SheetDescription className="flex items-center gap-2 flex-wrap">
                <span>{detail.customer_name ?? '—'}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">
                  {detail.customer_email ?? ''}
                </span>
                {detail.loyalty_tier && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <TierBadge tier={detail.loyalty_tier} />
                  </>
                )}
              </SheetDescription>
            </SheetHeader>
            <Tabs defaultValue="return" className="flex-1 flex flex-col min-h-0">
              <TabsList className="mx-8 mt-4 w-fit">
                <TabsTrigger value="return">Return</TabsTrigger>
                <TabsTrigger value="customer">Customer</TabsTrigger>
                <TabsTrigger value="activity">
                  <Activity className="size-3.5 mr-1" />
                  Activity{' '}
                  {detail.emails.length + detail.ai_audit_trail.length > 0 &&
                    `(${detail.emails.length + detail.ai_audit_trail.length})`}
                </TabsTrigger>
              </TabsList>
              <TabsContent
                value="return"
                className="flex-1 overflow-y-auto px-8 py-6"
              >
                <ReturnTab detail={detail} onMutated={onMutated} />
              </TabsContent>
              <TabsContent
                value="customer"
                className="flex-1 overflow-y-auto px-8 py-6"
              >
                <CustomerTab detail={detail} />
              </TabsContent>
              <TabsContent
                value="activity"
                className="flex-1 overflow-y-auto px-8 py-6"
              >
                <ActivityTab detail={detail} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
