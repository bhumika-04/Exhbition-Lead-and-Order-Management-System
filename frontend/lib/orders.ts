// Order helpers shared by the place-order and order-detail screens.

/** Advance/coupon band width — ₹1,00,000. Must match AdvanceCalculator.BandSize. */
export const ADVANCE_BAND_SIZE = 100000;
export const ADVANCE_PER_BAND = 11000;
export const COUPONS_PER_BAND = 4;

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
