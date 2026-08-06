'use client';

/**
 * Place order — step 1 (items).
 *
 * Built for speed at a counter: one Scan button adds a row, and the only things
 * on that row are the three that actually vary per piece — quantity, colour and
 * size. Everything else the catalogue already knows, and lives behind Edit.
 */

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  ArrowLeft, ScanLine, Trash2, Loader2, ShoppingBag, Pencil,
  Plus, Minus, X, ImageIcon, PackagePlus,
} from 'lucide-react';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';
import {
  ORDER_ITEM_TYPES, PRODUCT_CATEGORIES, takesCategory, takesSize,
  type LeadDetails, type LeadOrderSummary, type Product,
} from '@/lib/types';
import { money } from '@/lib/orders';
import { apiErrorMessage } from '@/lib/apiError';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import BarcodeScanner from '@/components/BarcodeScanner';

interface Row {
  key: string;
  productId: number | null;
  imagePath: string | null;
  name: string;              // what the row is called
  itemType: string;
  category: string | null;
  barcode: string;
  fabric: string;
  // The three the operator actually changes
  pieces: number;
  colour: string;
  size: string;
  // Behind Edit
  rate: string;
  customization: string;
}

let rowSeq = 0;
const newKey = () => `row-${++rowSeq}-${Date.now()}`;

export default function PlaceOrderPage() {
  const router = useRouter();
  const params = useParams();
  const leadId = parseInt(params.id as string);

  const [lead, setLead] = useState<LeadDetails | null>(null);
  const [existing, setExisting] = useState<LeadOrderSummary | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [scanOpen, setScanOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/auth/login'); return; }
    (async () => {
      try {
        const [l, s] = await Promise.all([api.getLead(leadId), api.getLeadOrderSummary(leadId)]);
        setLead(l);
        setExisting(s);
      } catch {
        toast.error('Could not load lead');
      } finally { setLoading(false); }
    })();
  }, [leadId, router]);

  const patch = (key: string, p: Partial<Row>) =>
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...p } : r)));

  const remove = (key: string) => setRows(rs => rs.filter(r => r.key !== key));

  const rowFromProduct = (p: Product): Row => ({
    key: newKey(),
    productId: p.product_id,
    imagePath: p.image_path ?? null,
    name: p.name || [p.category, p.product_type].filter(Boolean).join(' '),
    itemType: p.product_type,
    category: p.category ?? null,
    barcode: p.barcode,
    fabric: p.fabric ?? '',
    pieces: 1,
    colour: p.colour ?? '',
    size: p.size ?? '',
    rate: p.price != null ? String(p.price) : '',
    customization: '',
  });

  const blankRow = (barcode = ''): Row => ({
    key: newKey(),
    productId: null,
    imagePath: null,
    name: ORDER_ITEM_TYPES[0],
    itemType: ORDER_ITEM_TYPES[0],
    category: null,
    barcode,
    fabric: '',
    pieces: 1,
    colour: '',
    size: '',
    rate: '',
    customization: '',
  });

  /** A scan adds a row outright — no intermediate form to fill in. */
  const onScanned = async (barcode: string) => {
    const code = barcode.trim();
    if (!code || scanBusy) return;

    setScanBusy(true);
    try {
      const product = await api.getProductByBarcode(code);
      const row = rowFromProduct(product);
      setRows(rs => [...rs, row]);
      setScanOpen(false);
      toast.success(`Added ${row.name}`);
    } catch (err: any) {
      if (err?.response?.status === 404) {
        // Unknown code still becomes a row — losing the scan would be worse
        // than an incomplete line. Edit opens so it can be completed.
        const row = blankRow(code);
        setRows(rs => [...rs, row]);
        setScanOpen(false);
        setEditKey(row.key);
        toast(`${code} isn't in the catalogue — add the details`, { icon: 'ℹ️' });
      } else {
        toast.error(apiErrorMessage(err, 'Could not look that barcode up'));
      }
    } finally { setScanBusy(false); }
  };

  const addManual = () => {
    const row = blankRow();
    setRows(rs => [...rs, row]);
    setEditKey(row.key);
  };

  const lineAmount = (r: Row) => {
    const rate = parseFloat(r.rate);
    return Number.isFinite(rate) ? Math.max(0, rate) * Math.max(0, r.pieces) : 0;
  };

  const itemsTotal = rows.reduce((s, r) => s + lineAmount(r), 0);
  const anyPriced = rows.some(r => r.rate.trim() !== '');
  const totalPieces = rows.reduce((s, r) => s + r.pieces, 0);

  const save = async () => {
    if (rows.length === 0) { toast.error('Scan at least one item'); return; }

    const items = rows.map(r => {
      const rate = r.rate.trim() === '' ? null : parseFloat(r.rate);
      return {
        item_type: r.itemType,
        barcode: r.barcode.trim() || null,
        size: r.size.trim() || null,
        colour: r.colour.trim() || null,
        pieces: r.pieces,
        rate: rate !== null && Number.isFinite(rate) ? rate : null,
        customization: r.customization.trim() || null,
        product_id: r.productId,
      };
    });

    setSaving(true);
    try {
      const res = await api.createOrder({ lead_id: leadId, items, notes: notes.trim() || null });
      toast.success('Order created');
      router.push(`/orders/${res.order_id}`);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not create the order'));
    } finally { setSaving(false); }
  };

  const editing = rows.find(r => r.key === editKey) ?? null;

  if (loading) {
    return <div className="flex-1 flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
    </div>;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex items-center gap-3 shrink-0">
        <button onClick={() => router.back()} className="p-1.5 -ml-1.5 rounded-lg hover:bg-slate-100">
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-900 truncate">Place Order</p>
          <p className="text-[11px] text-slate-400 truncate">
            {lead?.primary_visitor_name || 'Lead'}
            {lead?.company_name ? ` · ${lead.company_name}` : ''}
          </p>
        </div>
        {rows.length > 0 && (
          <span className="text-[11px] font-semibold text-slate-500 shrink-0">
            {rows.length} item{rows.length === 1 ? '' : 's'} · {totalPieces} pc
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3">
        {/* Scan — the primary action, deliberately large */}
        <button
          onClick={() => setScanOpen(true)}
          className="w-full h-16 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center justify-center gap-2.5 transition-colors shadow-sm"
        >
          <ScanLine className="w-6 h-6" />
          <span className="text-base">Scan item</span>
        </button>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <PackagePlus className="w-10 h-10 text-slate-200" />
            <p className="text-sm text-slate-400">Scan a tag to add the first item</p>
            <button onClick={addManual} className="text-xs text-blue-600 hover:underline mt-1">
              or add one without a barcode
            </button>
          </div>
        ) : (
          <>
            {rows.map(r => (
              <motion.div
                key={r.key}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-slate-200 bg-white p-3"
              >
                <div className="flex gap-3">
                  <div className="w-12 h-14 rounded-lg bg-slate-100 shrink-0 overflow-hidden flex items-center justify-center">
                    {r.imagePath
                      ? <img src={api.uploadUrl(r.imagePath)} alt="" className="w-full h-full object-cover" />
                      : <ImageIcon className="w-4 h-4 text-slate-300" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900 truncate">{r.name}</p>
                        <p className="text-[11px] font-mono text-slate-400 truncate">
                          {r.barcode || 'no barcode'}
                        </p>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button onClick={() => setEditKey(r.key)} aria-label="Edit item"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => remove(r.key)} aria-label="Remove item"
                                className="p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* The only three fields that vary per piece */}
                    <div className="flex items-end gap-2 mt-2">
                      <div>
                        <span className="text-[10px] text-slate-400 block mb-0.5">Qty</span>
                        <div className="flex items-center h-9 rounded-lg border border-slate-200 bg-white">
                          <button
                            onClick={() => patch(r.key, { pieces: Math.max(1, r.pieces - 1) })}
                            aria-label="Decrease quantity"
                            className="w-8 h-full flex items-center justify-center text-slate-400 hover:text-slate-700"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="w-7 text-center text-sm font-semibold text-slate-800">{r.pieces}</span>
                          <button
                            onClick={() => patch(r.key, { pieces: r.pieces + 1 })}
                            aria-label="Increase quantity"
                            className="w-8 h-full flex items-center justify-center text-slate-400 hover:text-slate-700"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <MiniField label="Colour" value={r.colour}
                                 onChange={v => patch(r.key, { colour: v })} placeholder="—" />

                      {/* Sarees and stitched pieces carry no size */}
                      {takesSize(r.itemType, r.category) || r.productId === null ? (
                        <MiniField label="Size" value={r.size}
                                   onChange={v => patch(r.key, { size: v })} placeholder="—" />
                      ) : (
                        <div className="flex-1">
                          <span className="text-[10px] text-slate-400 block mb-0.5">Size</span>
                          <div className="h-9 flex items-center text-[11px] text-slate-400">
                            {r.category === 'Stitched' ? 'made to measure' : 'n/a'}
                          </div>
                        </div>
                      )}

                      <div className="text-right shrink-0 pb-1.5">
                        <span className="text-[10px] text-slate-400 block">Amount</span>
                        <span className="text-sm font-bold text-slate-900">
                          {r.rate.trim() === '' ? '—' : money(lineAmount(r))}
                        </span>
                      </div>
                    </div>

                    {r.customization && (
                      <p className="text-[11px] text-slate-500 italic mt-1.5 truncate">{r.customization}</p>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}

            <button onClick={addManual}
                    className="w-full h-10 rounded-xl border border-dashed border-slate-300 text-xs font-medium text-slate-500 hover:bg-white transition-colors">
              Add item without a barcode
            </button>
          </>
        )}

        {rows.length > 0 && (
          <>
            <Card className="border-slate-200">
              <CardContent className="p-4 space-y-2">
                {anyPriced ? (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500">Items total</span>
                    <span className="text-base font-bold text-slate-900">{money(itemsTotal)}</span>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400">
                    No prices yet — the order value comes from the slab you pick next.
                  </p>
                )}
                {(existing?.order_count ?? 0) > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-slate-400">
                      Existing orders ({existing?.order_count})
                    </span>
                    <span className="text-xs text-slate-500">{money(existing?.lead_total ?? 0)}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <label className="block text-xs">
              <span className="text-slate-500 font-medium">Order notes (optional)</span>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                        className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm resize-none"
                        placeholder="Anything to record against this order" />
            </label>

            <motion.div whileTap={{ scale: 0.99 }}>
              <Button onClick={save} disabled={saving} className="w-full h-12 gap-2 text-sm font-semibold">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingBag className="w-4 h-4" />}
                {saving ? 'Creating…' : 'Continue to payment'}
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
              className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-slate-900">Scan the tag</p>
                <button onClick={() => setScanOpen(false)} className="p-1 rounded-lg hover:bg-slate-100">
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </div>

              <BarcodeScanner
                value=""
                autoStart
                onChange={onScanned}
                placeholder="or type the barcode"
              />

              {scanBusy && (
                <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Looking it up…
                </p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full detail for one row */}
      <AnimatePresence>
        {editing && (
          <EditItemSheet
            row={editing}
            onChange={p => patch(editing.key, p)}
            onClose={() => setEditKey(null)}
            onRemove={() => { remove(editing.key); setEditKey(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function MiniField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="flex-1 min-w-0">
      <span className="text-[10px] text-slate-400 block mb-0.5">{label}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 px-2 rounded-lg border border-slate-200 bg-white text-sm text-center"
      />
    </label>
  );
}

/** Everything the row hides. Opened by Edit, or automatically for an unknown barcode. */
function EditItemSheet({ row, onChange, onClose, onRemove }: {
  row: Row;
  onChange: (p: Partial<Row>) => void;
  onClose: () => void;
  onRemove: () => void;
}) {
  const fromCatalogue = row.productId !== null;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[88vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <p className="text-sm font-bold text-slate-900">Item details</p>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {fromCatalogue && (
            <p className="text-[11px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
              From the catalogue. Changes here apply to this order only — they do not
              alter the product.
            </p>
          )}

          <Field label="Barcode">
            <input value={row.barcode} onChange={e => onChange({ barcode: e.target.value })}
                   className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm font-mono" />
          </Field>

          <Field label="Type">
            <div className="flex gap-2">
              {ORDER_ITEM_TYPES.map(t => (
                <button key={t}
                  onClick={() => onChange({
                    itemType: t,
                    // Sarees carry no category or size; drop them on switch.
                    category: takesCategory(t) ? (row.category ?? 'Readymade') : null,
                    size: takesSize(t, takesCategory(t) ? row.category : null) ? row.size : '',
                  })}
                  className={`flex-1 h-10 rounded-lg text-sm font-medium transition-colors ${
                    row.itemType === t ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {t}
                </button>
              ))}
            </div>
          </Field>

          {takesCategory(row.itemType) && (
            <Field label="Category">
              <div className="flex gap-2">
                {PRODUCT_CATEGORIES.map(c => (
                  <button key={c}
                    onClick={() => onChange({ category: c, size: c === 'Readymade' ? row.size : '' })}
                    className={`flex-1 h-10 rounded-lg text-sm font-medium transition-colors ${
                      row.category === c ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}>
                    {c}
                  </button>
                ))}
              </div>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Colour">
              <input value={row.colour} onChange={e => onChange({ colour: e.target.value })}
                     className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm" />
            </Field>
            {takesSize(row.itemType, row.category) ? (
              <Field label="Size">
                <input value={row.size} onChange={e => onChange({ size: e.target.value })}
                       className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm" />
              </Field>
            ) : (
              <Field label="Size">
                <div className="h-10 flex items-center text-[11px] text-slate-400">
                  {row.category === 'Stitched' ? 'Made to measure' : 'Not applicable'}
                </div>
              </Field>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Fabric">
              <input value={row.fabric} onChange={e => onChange({ fabric: e.target.value })}
                     className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm" />
            </Field>
            <Field label="Pieces">
              <input type="number" inputMode="numeric" min={1} value={row.pieces}
                     onChange={e => onChange({ pieces: Math.max(1, parseInt(e.target.value) || 1) })}
                     className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm" />
            </Field>
          </div>

          <Field label="Rate (₹) — optional">
            <input type="number" inputMode="decimal" min={0} value={row.rate}
                   onChange={e => onChange({ rate: e.target.value })}
                   placeholder="Leave blank to price by slab"
                   className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm" />
          </Field>

          <Field label="Customization">
            <textarea value={row.customization} rows={2}
                      onChange={e => onChange({ customization: e.target.value })}
                      placeholder="Alterations, special instructions…"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm resize-none" />
          </Field>
        </div>

        <div className="sticky bottom-0 bg-white flex gap-2 px-5 py-4 border-t border-slate-100">
          <Button variant="outline" onClick={onRemove}
                  className="h-10 gap-1.5 text-xs text-rose-600 border-rose-200 hover:bg-rose-50">
            <Trash2 className="w-3.5 h-3.5" /> Remove
          </Button>
          <Button onClick={onClose} className="flex-1 h-10 text-sm">Done</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs text-slate-500 font-medium">{label}</span>
      <div className="mt-1">{children}</div>
    </div>
  );
}
