/**
 * Retailer "logo" chips — a colored monogram per account, the way a category
 * manager's planning sheet tags each customer. Keyed by the retailerId the
 * plan/events API returns (R01..R05, see data_generation).
 */
export const RETAILER_CHIP: Record<string, { code: string; bg: string; fg: string }> = {
  R01: { code: 'VM', bg: '#C8281E', fg: '#FFFBF2' }, // ValuMax Stores (Mass, JBP account)
  R02: { code: 'GL', bg: '#1F5C4D', fg: '#FFFBF2' }, // Greenleaf Market
  R03: { code: 'HF', bg: '#2F5D8C', fg: '#FFFBF2' }, // Harbor Fresh Grocers
  R04: { code: 'QP', bg: '#E9A23B', fg: '#2A1F17' }, // QuickPantry (Convenience)
  R05: { code: 'BW', bg: '#5B3A7A', fg: '#FFFBF2' }, // BulkWise Club
};

export const retailerChip = (id: string) => RETAILER_CHIP[id] ?? { code: '··', bg: '#8C7B6B', fg: '#FFFBF2' };
