// Order helpers shared by the place-order and order-detail screens.

/** Must mirror AdvanceCalculator on the server. */
export const SLAB_SIZE = 100000;        // order-value slab width
export const ADVANCE_PER_SLAB = 11000;  // advance suggested per slab
export const COUPONS_PER_UNIT = 4;      // coupons per ADVANCE_PER_SLAB actually paid

/**
 * Coupons need BOTH an order of at least ₹1L and an advance of at least ₹11,000.
 * Whichever side has fewer complete units decides the count:
 *
 *   ₹50,000 + ₹11,000 →  0   under ₹1L earns nothing
 *   ₹2.5L   + ₹11,000 →  4   advance is the limiter
 *   ₹1L     + ₹44,000 →  4   value is the limiter — overpaying cannot farm coupons
 *   ₹2L     + ₹22,000 →  8
 *
 * Mirrors AdvanceCalculator.CouponsFor — keep the two in step.
 */
export function couponsFor(totalValue: number, totalAdvance: number): number {
  if (!Number.isFinite(totalValue) || !Number.isFinite(totalAdvance)) return 0;
  if (totalValue < SLAB_SIZE || totalAdvance < ADVANCE_PER_SLAB) return 0;

  const valueUnits   = Math.floor(totalValue / SLAB_SIZE);
  const advanceUnits = Math.floor(totalAdvance / ADVANCE_PER_SLAB);

  return Math.min(valueUnits, advanceUnits) * COUPONS_PER_UNIT;
}

/** Coupons a slab's suggested advance earns if paid in full. */
export function couponsForSlab(slab: number): number {
  return slab <= 0 ? 0 : slab * COUPONS_PER_UNIT;
}

/* ── Size × colour combinations ───────────────────────────────────────────
   Shared by the staff order form and the customer's own ordering page. A
   single count against "M, S, XL" in "blue, green" is unanswerable — the
   tailor cannot tell what to cut and the packer cannot tell what to box — so
   every combination carries its own quantity and the line total is their sum. */

/** A single orderable combination. Nulls mean the axis does not apply. */
export interface Combo { size: string | null; colour: string | null; key: string }

/** Anything that carries the two axes and a quantity map. */
export interface CombinableRow {
  sizes: string[];
  colours: string[];
  qty: Record<string, number>;
  /**
   * The catalogue's bracket notation: "(L,XL,2XL,3XL)" means the sizes ship
   * together rather than offering a choice. Carried onto the row so the order
   * form can seed the minimum the customer is obliged to take.
   */
  sizeIsSet?: boolean;
  colourIsSet?: boolean;
}

// JSON rather than a delimiter: sizes and colours are free text from Product
// Master, so any separator character could legitimately appear in a value.
export const comboKey = (size: string | null, colour: string | null) =>
  JSON.stringify([size, colour]);

/**
 * The grid of combinations for a row. With neither axis set this is a single
 * nameless combination, which is how a Saree (no size, no colour) keeps
 * behaving like a plain quantity.
 */
export function rowCombos(r: Pick<CombinableRow, 'sizes' | 'colours'>): Combo[] {
  const sizes: (string | null)[] = r.sizes.length ? r.sizes : [null];
  const colours: (string | null)[] = r.colours.length ? r.colours : [null];
  return sizes.flatMap(s => colours.map(c => ({ size: s, colour: c, key: comboKey(s, c) })));
}

export const rowPieces = (r: CombinableRow) =>
  rowCombos(r).reduce((sum, c) => sum + (r.qty[c.key] ?? 0), 0);

/**
 * Drops quantities for combinations that no longer exist and seeds new ones.
 *
 * A new combination defaults to 1 when there was no choice to make, and to 0
 * when there was — silently ordering six pieces off the back of ticking three
 * sizes and two colours is an expensive way to be helpful.
 *
 * "No choice" covers two cases:
 *  - a single combination, which is unambiguous; and
 *  - an axis the catalogue marks as a SET. "(L,XL,2XL,3XL)" is not four options
 *    to pick between, it is four pieces that ship together, so seeding them at
 *    zero would show a minimum of four as a total of nought and make the
 *    operator key what the sheet already said.
 *
 * A set axis seeds every one of ITS values; an axis that is a genuine choice
 * still starts empty, so "(L,XL) in blue or green" seeds neither colour until
 * one is picked, then fills both sizes under it.
 */
export function reconcileQty<T extends CombinableRow>(r: T): T {
  const combos = rowCombos(r);
  const qty: Record<string, number> = {};

  // Only the chosen values count: an unpicked colour has no combinations yet.
  const sizeSeeded   = r.sizeIsSet   || r.sizes.length <= 1;
  const colourSeeded = r.colourIsSet || r.colours.length <= 1;
  const seed = sizeSeeded && colourSeeded ? 1 : 0;

  for (const c of combos) qty[c.key] = r.qty[c.key] ?? seed;

  return { ...r, qty };
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

/**
 * Splits the comma-separated lists that Products and OrderItems store for size
 * and colour. Trims, drops blanks, and de-duplicates case-insensitively so
 * "38, 38 " does not yield two options.
 */
export function splitCsv(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const v = part.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/** Canonical form for storage — matches ProductService.NormaliseList on the server. */
export function joinCsv(values: string[]): string {
  return splitCsv(values.join(',')).join(', ');
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
