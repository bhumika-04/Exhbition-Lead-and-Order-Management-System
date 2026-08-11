'use client';

/**
 * Place order — step 1 (items).
 *
 * Scan-first. One button adds a row; the row shows only what varies per piece.
 * Rows collapse as new ones arrive so the newest item is always the one in view.
 */

import { useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  ArrowLeft, ScanLine, Trash2, Loader2, ShoppingBag, Pencil, ChevronDown,
  Plus, Minus, X, ImageIcon, PackagePlus, FileClock, ChevronRight,
} from 'lucide-react';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';
import {
  type LeadDetails, type LeadOrderSummary, type Product, type OrderSummary,
  type OrderItem,
} from '@/lib/types';
import {
  money, splitCsv, joinCsv,
  comboKey, rowCombos, rowPieces, reconcileQty,
} from '@/lib/orders';
import { apiErrorMessage } from '@/lib/apiError';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import BarcodeScanner from '@/components/BarcodeScanner';
import ChipRow from '@/components/ChipRow';
import QtyMatrix from '@/components/QtyMatrix';

interface Row {
  key: string;
  productId: number | null;
  imagePath: string | null;
  name: string;
  barcode: string;
  fabric: string;
  sizes: string[];      // several per line — same design in 38 and 40
  colours: string[];
  /**
   * Pieces per size × colour combination, keyed by comboKey().
   *
   * A single count against "M, S, XL" in "blue, green" is unanswerable — the
   * tailor cannot tell what to cut and the packer cannot tell what to box. Each
   * combination therefore carries its own quantity, and the line's total is
   * their sum.
   */
  qty: Record<string, number>;
  // From the catalogue's bracket notation — see reconcileQty.
  sizeIsSet: boolean;
  colourIsSet: boolean;
  remark: string;
  rate: string;
  expanded: boolean;
  // What THIS design is available in, from Product Master. The dropdown offers
  // these rather than every value in the catalogue, so the operator picks from
  // what can actually be supplied.
  sizeOptions: string[];
  colourOptions: string[];
}

let rowSeq = 0;
const newKey = () => `row-${++rowSeq}-${Date.now()}`;

export default function PlaceOrderPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const leadId = parseInt(params.id as string);

  /**
   * Editing an existing draft rather than starting a new order.
   *
   * Same screen either way — the operator is doing the same job, and a second
   * page that scanned items into a slightly different shape would drift from
   * this one. Only the load and the save differ.
   */
  const editOrderId = (() => {
    const raw = searchParams.get('edit');
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  })();

  const [lead, setLead] = useState<LeadDetails | null>(null);
  const [existing, setExisting] = useState<LeadOrderSummary | null>(null);
  const [drafts, setDrafts] = useState<OrderSummary[]>([]);
  const [sizeOptions, setSizeOptions] = useState<string[]>([]);
  const [colourOptions, setColourOptions] = useState<string[]>([]);

  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Errors stay hidden until a save is attempted — see save().
  const [showErrors, setShowErrors] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  // A pending row that is NOT in the list until "Add to cart" is pressed.
  const [draftRow, setDraftRow] = useState<Row | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/auth/login'); return; }
    (async () => {
      try {
        const [l, orders, opts] = await Promise.all([
          api.getLead(leadId),
          api.getOrdersForLead(leadId),
          api.getProductOptions().catch(() => ({ sizes: [], colours: [] })),
        ]);
        setLead(l);
        setExisting(orders.summary);
        setDrafts(orders.orders.filter(o => o.status_code === 'draft'));
        setSizeOptions(opts.sizes);
        setColourOptions(opts.colours);

        if (editOrderId !== null) {
          const existingOrder = await api.getOrder(editOrderId);
          // Guard the client side too. The server refuses to replace the lines
          // of anything but a draft, but arriving here on a confirmed order
          // would otherwise let someone fill in a form that cannot be saved.
          if (existingOrder.status_code !== 'draft') {
            toast.error('That order is no longer a draft — its items cannot be changed.');
            router.replace(`/orders/${editOrderId}`);
            return;
          }
          setRows(await rowsFromOrder(existingOrder.items));
          setNotes(existingOrder.notes ?? '');
        }
      } catch {
        toast.error('Could not load lead');
      } finally { setLoading(false); }
    })();
  }, [leadId, router]);

  /**
   * Any change to the size or colour lists reshapes the combination grid, so
   * quantities are reconciled in the same step — otherwise a de-selected size
   * leaves an orphan quantity that still counts toward the line total.
   */
  const patch = (key: string, p: Partial<Row>) =>
    setRows(rs => rs.map(r => {
      if (r.key !== key) return r;
      const next = { ...r, ...p };
      return 'sizes' in p || 'colours' in p ? reconcileQty(next) : next;
    }));

  const remove = (key: string) => setRows(rs => rs.filter(r => r.key !== key));

  /** Adds a row and collapses the rest, so the newest item is the one in view. */
  const addRow = (row: Row) =>
    setRows(rs => [...rs.map(r => ({ ...r, expanded: false })), { ...row, expanded: true }]);

  const rowFromProduct = (p: Product): Row => {
    const sizeOpts = splitCsv(p.size);
    const colourOpts = splitCsv(p.colour);
    return reconcileQty({
      key: newKey(),
      productId: p.product_id,
      imagePath: p.image_path ?? null,
      name: p.name || p.barcode,
      barcode: p.barcode,
      fabric: p.fabric ?? '',
      // Only one option means there is no decision to make — preselect it.
      // Several means the customer has a choice, so leave it for the operator
      // rather than guessing and having a wrong size ordered by default.
      // A set is not a choice: every value ships together, so select them all.
      sizes: p.size_is_set || sizeOpts.length === 1 ? sizeOpts : [],
      colours: p.colour_is_set || colourOpts.length === 1 ? colourOpts : [],
      sizeIsSet: !!p.size_is_set,
      colourIsSet: !!p.colour_is_set,
      qty: {},
      remark: '',
      rate: p.price != null ? String(p.price) : '',
      expanded: true,
      sizeOptions: sizeOpts,
      colourOptions: colourOpts,
    });
  };

  const blankRow = (barcode = ''): Row => reconcileQty({
    key: newKey(),
    productId: null,
    imagePath: null,
    name: '',
    barcode,
    fabric: '',
    sizes: [],
    colours: [],
    sizeIsSet: false,
    colourIsSet: false,
    qty: {},
    remark: '',
    rate: '',
    expanded: true,
    // No product behind it, so fall back to everything in the catalogue.
    sizeOptions: sizeOptions,
    colourOptions: colourOptions,
  });

  /**
   * Turns saved order lines back into editable rows.
   *
   * The order stores one line per size x colour combination, which is what the
   * packing list needs but not what the form edits — so lines are regrouped by
   * the design they belong to and their quantities rebuilt into the matrix.
   *
   * Grouped by product id where there is one and by barcode otherwise: two
   * lines of the same design must land in the same row, or the operator sees
   * the same garment twice and the set rules apply to neither.
   *
   * The catalogue is re-read for each design so the row offers every size and
   * colour it comes in, not merely the ones already ordered — otherwise adding
   * a size while editing would be impossible. A design since removed from the
   * catalogue falls back to the values on the order itself.
   */
  const rowsFromOrder = async (items: OrderItem[]): Promise<Row[]> => {
    const groups = new Map<string, OrderItem[]>();
    for (const it of items) {
      const key = it.product_id != null ? `p${it.product_id}` : `b${it.barcode ?? ''}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(it);
    }

    return Promise.all([...groups.values()].map(async lines => {
      const first = lines[0];
      let product: Product | null = null;
      if (first.barcode) {
        try { product = await api.getProductByBarcode(first.barcode); } catch { /* retired design */ }
      }

      // splitCsv, not the raw value: orders written before the snapshot bug was
      // fixed stored the design's whole list on every line ("M, L, XL, 2XL"),
      // which would come back as one nonsense chip matching no option. Splitting
      // makes those legacy lines load as the selection they were meant to be.
      const uniq = (vs: (string | null | undefined)[]) =>
        [...new Set(vs.flatMap(v => splitCsv(v ?? undefined)))];

      const sizeOpts   = product ? splitCsv(product.size)   : uniq(lines.map(l => l.size));
      const colourOpts = product ? splitCsv(product.colour) : uniq(lines.map(l => l.colour));

      // Keys are built from the SPLIT values so they match the chips above.
      // A legacy line carrying the whole list spreads its pieces across the
      // combinations it covered rather than hiding behind a key nothing reads.
      const qty: Record<string, number> = {};
      for (const l of lines) {
        const ss = splitCsv(l.size);
        const cs = splitCsv(l.colour);
        for (const sz of ss.length ? ss : [null]) {
          for (const c of cs.length ? cs : [null]) {
            qty[comboKey(sz, c)] = l.pieces;
          }
        }
      }

      return {
        key: newKey(),
        productId: first.product_id ?? null,
        imagePath: product?.image_path ?? null,
        name: product?.name || first.barcode || 'Item',
        barcode: first.barcode ?? '',
        fabric: first.fabric ?? product?.fabric ?? '',
        sizes: uniq(lines.map(l => l.size)),
        colours: uniq(lines.map(l => l.colour)),
        sizeIsSet: !!product?.size_is_set,
        colourIsSet: !!product?.colour_is_set,
        qty,
        remark: first.customization ?? '',
        rate: first.rate != null ? String(first.rate) : '',
        expanded: false,
        sizeOptions: sizeOpts,
        colourOptions: colourOpts,
      } as Row;
    }));
  };

  /** A recognised scan is added outright. An unknown one becomes a draft to confirm. */
  const onScanned = async (barcode: string) => {
    const code = barcode.trim();
    if (!code || scanBusy) return;

    setScanBusy(true);
    try {
      const product = await api.getProductByBarcode(code);
      const row = rowFromProduct(product);
      addRow(row);
      setScanOpen(false);
      toast.success(`Added ${row.name}`);
    } catch (err: any) {
      if (err?.response?.status === 404) {
        setScanOpen(false);
        setDraftRow(blankRow(code));
        toast(`${code} isn't in the catalogue — fill in the details`, { icon: 'ℹ️' });
      } else {
        toast.error(apiErrorMessage(err, 'Could not look that barcode up'));
      }
    } finally { setScanBusy(false); }
  };

  const lineAmount = (r: Row) => {
    const rate = parseFloat(r.rate);
    return Number.isFinite(rate) ? Math.max(0, rate) * rowPieces(r) : 0;
  };

  const itemsTotal = rows.reduce((s, r) => s + lineAmount(r), 0);
  const anyPriced = rows.some(r => r.rate.trim() !== '');
  const totalPieces = rows.reduce((s, r) => s + rowPieces(r), 0);

  // A row where every combination is still zero would silently contribute
  // nothing to the order, so it is called out rather than quietly dropped.
  const emptyRows = rows.filter(r => rowPieces(r) === 0);

  const save = async () => {
    if (rows.length === 0) { toast.error('Scan at least one item'); return; }

    if (emptyRows.length > 0) {
      // Only from here does the grid start showing errors. Colouring it before
      // the operator has done anything wrong just trains them to ignore red.
      setShowErrors(true);
      const first = emptyRows[0];
      setRows(rs => rs.map(r => (r.key === first.key ? { ...r, expanded: true } : r)));
      toast.error(
        emptyRows.length === 1
          ? `Set a quantity for ${first.name}`
          : `${emptyRows.length} items have no quantity set`
      );
      return;
    }

    // One API line per combination that was actually ordered. Storing
    // "M, S, XL" against a single count loses which size the pieces were for;
    // a line each keeps the Sales Order and the packing list answerable.
    // Zero-quantity combinations are dropped — CK_OrderItems_Pieces requires
    // Pieces > 0, so sending them would fail the insert.
    const items = rows.flatMap(r => {
      const rate = r.rate.trim() === '' ? null : parseFloat(r.rate);
      return rowCombos(r)
        .filter(c => (r.qty[c.key] ?? 0) > 0)
        .map(c => ({
          barcode: r.barcode.trim() || null,
          size: c.size,
          colour: c.colour,
          pieces: r.qty[c.key],
          rate: rate !== null && Number.isFinite(rate) ? rate : null,
          customization: r.remark.trim() || null,
          product_id: r.productId,
        }));
    });

    setSaving(true);
    try {
      if (editOrderId !== null) {
        await api.updateOrder(editOrderId, { items, notes: notes.trim() || null });
        toast.success('Order updated');
        router.push(`/orders/${editOrderId}`);
      } else {
        const res = await api.createOrder({ lead_id: leadId, items, notes: notes.trim() || null });
        toast.success('Order created');
        router.push(`/orders/${res.order_id}`);
      }
    } catch (err) {
      toast.error(apiErrorMessage(err,
        editOrderId !== null ? 'Could not save the changes' : 'Could not create the order'));
    } finally { setSaving(false); }
  };

  const editing = draftRow ?? rows.find(r => r.key === editKey) ?? null;

  if (loading) {
    return <div className="flex-1 flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground/50" />
    </div>;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      <div className="bg-card border-b border-border px-3 md:px-6 py-2.5 md:py-0 md:min-h-[65px]
                      flex items-center gap-2 md:gap-3 shrink-0">
        <button onClick={() => router.back()} aria-label="Back"
                className="p-1.5 -ml-1 rounded-lg hover:bg-secondary shrink-0">
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm md:text-base font-semibold text-foreground truncate leading-tight">
            {editOrderId !== null ? 'Edit Order' : 'Place Order'}
          </p>
          <p className="text-[11px] text-muted-foreground truncate leading-tight">
            {lead?.primary_visitor_name || 'Lead'}
            {lead?.company_name ? ` · ${lead.company_name}` : ''}
          </p>
        </div>
        {rows.length > 0 && (
          <span className="text-[11px] font-medium text-muted-foreground shrink-0 tabular text-right">
            {rows.length} item{rows.length === 1 ? '' : 's'}
            <span className="hidden xs:inline"> · </span>
            <span className="block xs:inline">{totalPieces} pc</span>
          </span>
        )}
      </div>

      {/*
        Full width, matching Product Master and Orders. A centred max-width
        column left a band of empty page down each side on a desktop screen.

        Deliberately NOT a flex column. This container has a constrained height
        (flex-1 inside the page shell), so as a flex parent it would hand every
        card a default flex-shrink of 1 and squash them to fit rather than
        scroll — and the cards clip, so an expanded item lost the bottom of its
        quantity matrix. The empty state below carries its own min-height
        instead of stretching to fill.
      */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-3 md:py-4 space-y-3 w-full">
        {/* An unfinished order already exists — offer it before a second one is
            started by accident. */}
        {drafts.length > 0 && (
          <div className="rounded-xl border border-warning/25 bg-warning/[0.07] p-3 space-y-2">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <FileClock className="w-3.5 h-3.5" />
              {drafts.length === 1 ? 'This lead has an unfinished order' : `${drafts.length} unfinished orders`}
            </p>
            {drafts.map(d => (
              <button
                key={d.order_id}
                onClick={() => router.push(`/orders/${d.order_id}`)}
                className="w-full flex items-center gap-2 rounded-lg bg-card border border-warning/25 px-3 py-2 text-left hover:border-warning/40"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground">{d.order_number}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {d.item_count} item{d.item_count === 1 ? '' : 's'} · {d.total_pieces} pc
                    {d.effective_value > 0 ? ` · ${money(d.effective_value)}` : ''}
                  </p>
                </div>
                <span className="text-[11px] font-semibold text-warning shrink-0">Continue</span>
                <ChevronRight className="w-3.5 h-3.5 text-warning shrink-0" />
              </button>
            ))}
            <p className="text-[10px] text-warning">
              Continue it, or keep scanning below to start a separate order.
            </p>
          </div>
        )}

        {/* Was a full-width 64px slab, which on a phone ate a quarter of the
            screen above the items it exists to add. */}
        <button
          onClick={() => setScanOpen(true)}
          className="w-full h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground
                     font-medium text-sm flex items-center justify-center gap-2
                     shadow-sm hover:shadow transition-all active:translate-y-px
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <ScanLine className="w-4 h-4" />
          Scan item
        </button>

        {rows.length === 0 ? (
          <div className="min-h-[45vh] flex flex-col items-center justify-center gap-2 text-center">
            <PackagePlus className="w-10 h-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Scan a tag to add the first item</p>
          </div>
        ) : (
          <>
            {rows.map(r => (
              <motion.div
                key={r.key}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg border border-border bg-card shadow-xs overflow-hidden"
              >
                {/* Row 1 — summary + qty. Always visible; tap to expand. */}
                <div className="flex gap-2.5 p-2.5 sm:p-3">
                  <button
                    onClick={() => patch(r.key, { expanded: !r.expanded })}
                    className="flex gap-2.5 flex-1 min-w-0 text-left"
                  >
                    <div className="w-10 h-12 sm:w-11 sm:h-14 rounded-md bg-secondary shrink-0 overflow-hidden flex items-center justify-center">
                      {r.imagePath
                        ? <img src={api.uploadUrl(r.imagePath)} alt="" className="w-full h-full object-cover" />
                        : <ImageIcon className="w-4 h-4 text-muted-foreground/40" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                      <p className="text-[11px] font-mono text-muted-foreground truncate">
                        {r.barcode || 'no barcode'}
                      </p>
                      {!r.expanded && (
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                          {[r.sizes.join('/'), r.colours.join('/')].filter(Boolean).join(' · ') || 'no size or colour'}
                        </p>
                      )}
                    </div>
                  </button>

                  {/* Read-only total: the pieces are set per combination below,
                      so a stepper here would have no single value to change. */}
                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                    <span className={cn('text-sm font-semibold tabular',
                      rowPieces(r) > 0 ? 'text-foreground'
                        : showErrors ? 'text-destructive' : 'text-muted-foreground/50',
                    )}>
                      {rowPieces(r)} pc
                    </span>
                    <span className="text-xs text-muted-foreground tabular">
                      {r.rate.trim() === '' ? '—' : money(lineAmount(r))}
                    </span>
                  </div>

                  <button onClick={() => patch(r.key, { expanded: !r.expanded })}
                          aria-label={r.expanded ? 'Collapse' : 'Expand'}
                          className="p-1 self-start text-muted-foreground/50 hover:text-muted-foreground">
                    <ChevronDown className={`w-4 h-4 transition-transform ${r.expanded ? 'rotate-180' : ''}`} />
                  </button>
                </div>

                {/*
                  A CSS grid-template-rows transition, deliberately NOT framer-motion.

                  Animating height to "auto" makes framer-motion measure the panel
                  once and animate to that pixel value. The measurement goes stale
                  the moment the content grows — picking a second colour adds a
                  column to the quantity matrix — leaving the panel shorter than
                  what is inside it, which is what painted the surplus over the
                  next card.

                  0fr -> 1fr needs no measurement: the browser resolves the track
                  against whatever the content currently is. framer-motion cannot
                  interpolate `fr` though, so this is a plain CSS transition and
                  the panel stays mounted — an unmounting element has nothing to
                  transition from. min-h-0 is required or the grid item refuses to
                  shrink below its content.
                */}
                <div className={cn('grid transition-[grid-template-rows] duration-200 ease-out',
                                   r.expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                  {/* Three levels, all of them load-bearing: the grid track sets
                      the height, this one clips, and only the innermost carries
                      padding and the divider. Put the padding on the clipper and
                      a collapsed row still shows a band of it, because a
                      border-box element cannot be shorter than its own padding. */}
                  <div className="min-h-0 overflow-hidden">
                      <div className="px-3 pb-3 pt-2 space-y-2 border-t border-border">
                        {/* Row 2 — size and colour, several of each. Chips rather
                            than dropdowns, matching the customer's own page: the
                            lists come from a single barcode and are short, so
                            every option is visible without opening anything and
                            picking two is two taps. Staff talk customers through
                            this, so the two screens read the same. */}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <ChipRow
                            label="Size"
                            values={r.sizes}
                            options={r.sizeOptions}
                            onChange={v => patch(r.key, { sizes: v })}
                            emptyHint="No sizes on this design"
                            locked={r.sizeIsSet || r.sizeOptions.length === 1}
                            lockedHint={r.sizeIsSet ? 'Every size ships together — none can be removed.' : 'The only option on this design.'}
                          />
                          <ChipRow
                            label="Colour"
                            values={r.colours}
                            options={r.colourOptions}
                            onChange={v => patch(r.key, { colours: v })}
                            emptyHint="No colours on this design"
                            locked={r.colourIsSet || r.colourOptions.length === 1}
                            lockedHint={r.colourIsSet ? 'Every colour ships together — none can be removed.' : 'The only option on this design.'}
                          />
                        </div>

                        {/* Row 3 — quantities and customization side by side on a
                            wide screen, stacked on mobile where there is no
                            width to share.

                            Proportional tracks, not auto: the matrix wraps to
                            whatever it is given, and an auto track would size it
                            to every field on one line and never let it wrap. */}
                        <div className="lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]
                                        lg:gap-5 lg:items-start space-y-2 lg:space-y-0">
                          <QtyMatrix
                            sizes={r.sizes}
                            colours={r.colours}
                            qty={r.qty}
                            comboKey={comboKey}
                            invalid={showErrors}
                            onChange={(k, v) => patch(r.key, { qty: { ...r.qty, [k]: v } })}
                            onBulk={next => patch(r.key, { qty: next })}
                          />

                          {/* Customization is per item, carried onto the order
                              line and printed on the Sales Order — the tailor's
                              instruction, not a private note. */}
                          <label className="block">
                            <span className="text-[10px] text-muted-foreground block mb-0.5">
                              Customization
                            </span>
                            <input
                              value={r.remark}
                              onChange={e => patch(r.key, { remark: e.target.value })}
                              placeholder="Alterations, sleeve length, special instructions"
                              enterKeyHint="done"
                              autoCapitalize="sentences"
                              className="w-full h-9 px-2 rounded-lg border border-border bg-card text-sm
                                         focus:outline-none focus:ring-2 focus:ring-ring/30"
                            />
                          </label>
                        </div>

                        <div className="flex gap-2 pt-0.5">
                          <button onClick={() => setEditKey(r.key)}
                                  className="text-[11px] text-muted-foreground hover:text-primary flex items-center gap-1">
                            <Pencil className="w-3 h-3" /> All details
                          </button>
                          <button onClick={() => remove(r.key)}
                                  className="text-[11px] text-muted-foreground hover:text-destructive flex items-center gap-1 ml-auto">
                            <Trash2 className="w-3 h-3" /> Remove
                          </button>
                        </div>
                      </div>
                  </div>
                </div>
              </motion.div>
            ))}

          </>
        )}

        {rows.length > 0 && (
          <>
            <Card className="border-border">
              <CardContent className="p-4 space-y-2">
                {anyPriced ? (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Items total</span>
                    <span className="text-base font-bold text-foreground">{money(itemsTotal)}</span>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    No prices yet — the order value comes from the slab you pick next.
                  </p>
                )}
                {(existing?.order_count ?? 0) > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-muted-foreground">
                      Existing orders ({existing?.order_count})
                    </span>
                    <span className="text-xs text-muted-foreground">{money(existing?.lead_total ?? 0)}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <label className="block text-xs">
              <span className="text-muted-foreground font-medium">Order notes (optional)</span>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                        enterKeyHint="done" autoCapitalize="sentences"
                        className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-card text-sm resize-none
                                   focus:outline-none focus:ring-2 focus:ring-ring/30"
                        placeholder="Anything to record against this order" />
            </label>

            <motion.div whileTap={{ scale: 0.99 }}>
              <Button onClick={save} disabled={saving} className="w-full h-12 gap-2 text-sm font-semibold">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingBag className="w-4 h-4" />}
                {saving
                  ? (editOrderId !== null ? 'Saving…' : 'Creating…')
                  : (editOrderId !== null ? 'Save changes' : 'Continue to payment')}
              </Button>
            </motion.div>
          </>
        )}

        <div className="md:hidden h-20" />
      </div>

      {/* Scan sheet */}
      <AnimatePresence>
        {scanOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setScanOpen(false)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-card w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-foreground">Scan the tag</p>
                <button onClick={() => setScanOpen(false)} className="p-1 rounded-lg hover:bg-secondary">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              <BarcodeScanner value="" autoStart onChange={onScanned} placeholder="or type the barcode" />
              {scanBusy && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Looking it up…
                </p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full detail — a draft waiting to be added, or an existing row */}
      <AnimatePresence>
        {editing && (
          <ItemSheet
            row={editing}
            isDraft={draftRow !== null}
            onChange={p => draftRow
              // Same reconciliation as patch() — the draft is not in `rows` yet,
              // so it does not go through that path.
              ? setDraftRow(prev => {
                  if (!prev) return prev;
                  const next = { ...prev, ...p };
                  return 'sizes' in p || 'colours' in p ? reconcileQty(next) : next;
                })
              : patch(editing.key, p)}
            onConfirm={() => {
              if (draftRow) { addRow(draftRow); setDraftRow(null); toast.success('Added to cart'); }
              else setEditKey(null);
            }}
            onCancel={() => { setDraftRow(null); setEditKey(null); }}
            onRemove={draftRow ? undefined : () => { remove(editing.key); setEditKey(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Full detail for one item. Doubles as the "add without a barcode" form. */
function ItemSheet({
  row, isDraft, onChange, onConfirm, onCancel, onRemove,
}: {
  row: Row;
  isDraft: boolean;
  onChange: (p: Partial<Row>) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onCancel}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-card w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[88vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-card flex items-center justify-between px-5 py-4 border-b border-border z-10">
          <p className="text-sm font-bold text-foreground">
            {isDraft ? 'New item' : 'Item details'}
          </p>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-secondary">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {!isDraft && row.productId !== null && (
            <p className="text-[11px] text-muted-foreground bg-secondary/50 rounded-lg px-3 py-2">
              From the catalogue. Changes here apply to this order only — they do not
              alter the product.
            </p>
          )}

          {/* A scanned line's barcode is read-only: it is the identity of the
              product this line was priced and snapshotted from, and retyping it
              would leave the line pointing at one design while showing another.
              A line typed in without a scan has nothing to contradict, so it
              stays editable. */}
          <Field label="Barcode">
            {row.productId !== null ? (
              <div className="w-full h-10 px-3 rounded-lg border border-border bg-secondary/50
                              text-sm font-mono text-muted-foreground flex items-center justify-between gap-2">
                <span className="truncate">{row.barcode}</span>
                <span className="text-[10px] font-sans shrink-0">from catalogue</span>
              </div>
            ) : (
              <input value={row.barcode} onChange={e => onChange({ barcode: e.target.value })}
                     placeholder="Optional"
                     className="w-full h-10 px-3 rounded-lg border border-border text-sm font-mono" />
            )}
          </Field>

          <Field label="Item name">
            <input value={row.name} onChange={e => onChange({ name: e.target.value })}
                   className="w-full h-10 px-3 rounded-lg border border-border text-sm" />
          </Field>

          <div className="space-y-3">
            <ChipRow label="Size" values={row.sizes} options={row.sizeOptions}
                     onChange={(v: string[]) => onChange({ sizes: v })}
                     emptyHint="No sizes on this design"
                     locked={row.sizeIsSet || row.sizeOptions.length === 1}
                     lockedHint={row.sizeIsSet ? 'Every size ships together — none can be removed.' : 'The only option on this design.'} />
            <ChipRow label="Colour" values={row.colours} options={row.colourOptions}
                     onChange={(v: string[]) => onChange({ colours: v })}
                     emptyHint="No colours on this design"
                     locked={row.colourIsSet || row.colourOptions.length === 1}
                     lockedHint={row.colourIsSet ? 'Every colour ships together — none can be removed.' : 'The only option on this design.'} />
          </div>

          <Field label="Fabric">
            <input value={row.fabric} onChange={e => onChange({ fabric: e.target.value })}
                   className="w-full h-10 px-3 rounded-lg border border-border text-sm" />
          </Field>

          <QtyMatrix
            sizes={row.sizes}
            colours={row.colours}
            qty={row.qty}
            comboKey={comboKey}
            onChange={(k, v) => onChange({ qty: { ...row.qty, [k]: v } })}
            onBulk={next => onChange({ qty: next })}
          />

          <Field label="Rate (₹) — optional">
            <NumberInput mode="decimal" value={row.rate}
                         onValueChange={v => onChange({ rate: v })}
                         placeholder="Leave blank to price by slab"
                         enterKeyHint="done" />
          </Field>

          <Field label="Remark">
            <textarea value={row.remark} rows={2}
                      onChange={e => onChange({ remark: e.target.value })}
                      placeholder="Alterations, special instructions…"
                      className="w-full px-3 py-2 rounded-lg border border-border text-sm resize-none" />
          </Field>
        </div>

        <div className="sticky bottom-0 bg-card flex gap-2 px-5 py-4 border-t border-border">
          {onRemove ? (
            <Button variant="outline" onClick={onRemove}
                    className="h-10 gap-1.5 text-xs text-destructive border-destructive/25 hover:bg-destructive/[0.07]">
              <Trash2 className="w-3.5 h-3.5" /> Remove
            </Button>
          ) : (
            <Button variant="outline" onClick={onCancel} className="h-10 text-xs">Cancel</Button>
          )}
          <Button onClick={onConfirm} className="flex-1 h-10 gap-1.5 text-sm">
            {isDraft && <Plus className="w-4 h-4" />}
            {isDraft ? 'Add to cart' : 'Done'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
      <div className="mt-1">{children}</div>
    </div>
  );
}
