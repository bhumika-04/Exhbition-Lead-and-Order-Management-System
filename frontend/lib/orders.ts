// Order helpers shared by the place-order and order-detail screens.

/** Must mirror AdvanceCalculator on the server. */
export const SLAB_SIZE = 100000;        // order-value slab width
export const ADVANCE_PER_SLAB = 11000;  // advance suggested per slab
export const COUPONS_PER_UNIT = 4;      // coupons per ADVANCE_PER_SLAB actually paid

/**
 * Coupons follow the advance ACTUALLY TAKEN, not the order value.
 * ₹11,000 paid → 4 coupons, even against a ₹2.5L order.
 * Mirrors AdvanceCalculator.CouponsForAdvance — keep the two in step.
 */
export function couponsForAdvance(totalAdvance: number): number {
  if (!Number.isFinite(totalAdvance) || totalAdvance < ADVANCE_PER_SLAB) return 0;
  return Math.floor(totalAdvance / ADVANCE_PER_SLAB) * COUPONS_PER_UNIT;
}

/** Slab an order value falls into. Exact multiples land in the upper slab. */
export function slabForValue(orderValue: number): number {
  if (!Number.isFinite(orderValue) || orderValue <= 0) return 0;
  return Math.floor(orderValue / SLAB_SIZE);
}

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

export function money(value: number | null | undefined): string {
  return inr.format(Number.isFinite(value as number) ? (value as number) : 0);
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
};

export const ORDER_STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  confirmed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-rose-100 text-rose-700',
};
