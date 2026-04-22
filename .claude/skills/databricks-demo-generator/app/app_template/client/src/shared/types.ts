/**
 * Types that cross the client/server boundary. Keep in sync with
 * server/db/queries/returns.ts + server/db/queries/chat.ts.
 *
 * The app is small enough that hand-copying these is simpler than a
 * shared package. If this file grows past ~200 lines, consider a
 * proper shared lib.
 */

export type ReturnStatus = 'pending' | 'approved' | 'rejected' | 'escalated';
export type Decision = 'approved' | 'rejected' | 'escalated';

export type ReturnRow = {
  id: string;
  customerId: string | null;
  customerName: string;
  customerEmail: string;
  loyaltyTier: string | null;
  sku: string | null;
  productName: string | null;
  category: string | null;
  lot: string | null;
  returnReason: string | null;
  returnValueUsd: string;
  status: ReturnStatus;
  region: string | null;
  returnDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmailEntry = {
  at: string;
  direction: 'outgoing' | 'incoming';
  from?: string;
  to?: string;
  subject: string;
  body: string;
};

export type AuditEntry = {
  at: string;
  by: string;
  action: 'approved' | 'rejected' | 'escalated' | 'email_sent' | 'note';
  notes?: string;
  tool?: string;
};

export type ReturnDetail = {
  return_id: string;
  order_id: string | null;
  lot_id: string | null;
  facility: string | null;
  product_id: string | null;
  product_name: string | null;
  category: string | null;
  return_reason: string | null;
  return_reason_text: string | null;
  refund_amount_usd: string;
  status: ReturnStatus;
  region: string | null;
  return_date: string | null;
  order_date: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  loyalty_tier: string | null;
  customer_region: string | null;
  registration_date: string | null;
  order_total_usd: string | null;
  emails: EmailEntry[];
  ai_audit_trail: AuditEntry[];
};

export type ReturnsSummary = {
  status: ReturnStatus;
  n: number;
  total_usd: string;
};

export type LotRow = {
  lot_id: string;
  return_count: number;
  pending_count: number;
  total_refund_usd: string;
  facility: string | null;
  product_count: number;
  product_names: string | null;
};

export type FacilityRow = {
  facility: string;
  return_count: number;
  pending_count: number;
  total_refund_usd: string;
};

export type FacilityLotRow = {
  lot_id: string;
  return_count: number;
  pending_count: number;
  total_refund_usd: string;
  product_count: number;
  product_names: string | null;
};

export type CustomerOrder = {
  order_id: string;
  order_date: string | null;
  total_usd: string;
  status: string | null;
  item_count: number;
};

export type ActivityEvent =
  | {
      kind: 'email';
      return_id: string;
      at: string;
      direction: 'outgoing' | 'incoming';
      from: string | null;
      to: string | null;
      subject: string;
      body: string;
    }
  | {
      kind: 'audit';
      return_id: string;
      at: string;
      by: string;
      action: string;
      notes: string | null;
      tool: string | null;
    };
