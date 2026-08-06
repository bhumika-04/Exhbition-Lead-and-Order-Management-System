'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus, Trash2, Loader2, ShoppingBag, Ticket } from 'lucide-react';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';
import { ORDER_ITEM_TYPES, type LeadDetails, type LeadOrderSummary, type Product } from '@/lib/types';
import BarcodeScanner from '@/components/BarcodeScanner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { money } from '@/lib/orders';

interface ItemRow {
  item_type: string;
  barcode: string;
  size: string;
  colour: string;
  pieces: string;
  rate: string;
  customization: string;
  product?: Product | null;      // resolved from the barcode
  lookupError?: string | null;
  looking?: boolean;
}

const emptyRow = (): ItemRow => ({
  item_type: ORDER_ITEM_TYPES[0],
  barcode: '',
  size: '',
  colour: '',
  pieces: '1',
  rate: '',
  customization: '',
  product: null,
});

export default function PlaceOrderPage() {
  const router = useRouter();
  const params = useParams();
  const leadId = parseInt(params.id as string);

  const [lead, setLead] = useState<LeadDetails | null>(null);
  const [existing, setExisting] = useState<LeadOrderSummary | null>(null);
  const [rows, setRows] = useState<ItemRow[]>([emptyRow()]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/auth/login'); return; }
    (async () => {
      try {
        const [l, s] = await Promise.all([
          api.getLead(leadId),
          api.getLeadOrderSummary(leadId),
        ]);
        setLead(l);
        setExisting(s);
      } catch {
        toast.error('Could not load lead');
      } finally {
        setLoading(false);
      }
    })();
  }, [leadId, router]);

  const setRow = (i: number, patch: Partial<ItemRow>) =>
    setRows(rs => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  /**
   * Resolves a scanned barcode against the Product Master and fills the line.
   * The rate is prefilled from the catalogue but stays editable — discounts are
   * agreed at the counter, and the server re-reads the product anyway.
   */
  const lookupBarcode = async (i: number, barcode: string) => {
    const code = barcode.trim();
    setRow(i, { barcode: code, product: null, lookupError: null });
    if (!code) return;

    setRow(i, { looking: true });
    try {
      const p = await api.getProductByBarcode(code);
      setRow(i, {
        product: p,
        item_type: p.product_type,
        size: p.size ?? '',
        colour: p.colour ?? '',
        rate: String(p.price ?? ''),
        looking: false,
        lookupError: null,
      });
    } catch (err: any) {
      setRow(i, {
        looking: false,
        lookupError: err.response?.status === 404
          ? 'No product with that barcode — enter the details by hand'
          : 'Could not check that barcode',
      });
    }
  };

  const addRow = () => setRows(rs => [...rs, emptyRow()]);
  const removeRow = (i: number) =>
    setRows(rs => (rs.length === 1 ? rs : rs.filter((_, idx) => idx !== i)));

  const lineAmount = (r: ItemRow) => {
    const pcs = parseInt(r.pieces);
    const rate = parseFloat(r.rate);
    if (!Number.isFinite(pcs) || !Number.isFinite(rate)) return 0;
    return Math.max(0, pcs) * Math.max(0, rate);
  };

  const orderTotal = rows.reduce((sum, r) => sum + lineAmount(r), 0);
  const anyPriced = rows.some(r => r.rate.trim() !== '');
  const priorTotal = existing?.lead_total ?? 0;

  const save = async () => {
    const items = rows
      .map(r => {
        // Rate is optional — an unpriced line is valid, because the order value
        // can come from the slab chosen on the next step instead.
        const rateRaw = r.rate.trim();
        const rate = rateRaw === '' ? null : parseFloat(rateRaw);
        return {
          item_type: r.item_type.trim(),
          barcode: r.barcode.trim() || null,
          size: r.size.trim() || null,
          colour: r.colour.trim() || null,
          pieces: parseInt(r.pieces),
          rate,
          customization: r.customization.trim() || null,
          // The server re-reads the product and snapshots it onto the line.
          product_id: r.product?.product_id ?? null,
        };
      })
      .filter(i => i.item_type);

    if (items.length === 0) { toast.error('Add at least one item'); return; }
    for (const [i, item] of items.entries()) {
      if (!Number.isFinite(item.pieces) || item.pieces <= 0) {
        toast.error(`Line ${i + 1}: pieces must be at least 1`); return;
      }
      if (item.rate !== null && (!Number.isFinite(item.rate) || item.rate < 0)) {
        toast.error(`Line ${i + 1}: enter a valid rate or leave it blank`); return;
      }
    }

    setSaving(true);
    try {
      const res = await api.createOrder({ lead_id: leadId, items, notes: notes.trim() || null });
      toast.success('Order created');
      router.push(`/orders/${res.order_id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not create order');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex items-center gap-3 shrink-0">
        <button onClick={() => router.back()} className="p-1.5 -ml-1.5 rounded-lg hover:bg-slate-100">
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 truncate">Place Order</p>
          <p className="text-[11px] text-slate-400 truncate">
            {lead?.primary_visitor_name || 'Lead'}
            {lead?.company_name ? ` · ${lead.company_name}` : ''}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5 space-y-4">
        {/* Items */}
        {rows.map((row, i) => (
          <Card key={i} className="border-slate-200">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Item {i + 1}
                </span>
                {rows.length > 1 && (
                  <button
                    onClick={() => removeRow(i)}
                    className="text-slate-300 hover:text-rose-500 transition-colors"
                    aria-label={`Remove item ${i + 1}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 text-xs">
                  <span className="text-slate-500 font-medium">Type</span>
                  <select
                    value={row.item_type}
                    onChange={e => setRow(i, { item_type: e.target.value })}
                    className="mt-1 w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm"
                  >
                    {ORDER_ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>

                <div className="col-span-2">
                  <BarcodeScanner
                    label="Barcode"
                    value={row.barcode}
                    onChange={v => lookupBarcode(i, v)}
                  />
                  {row.looking && (
                    <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" /> Looking that up…
                    </p>
                  )}
                  {row.lookupError && (
                    <p className="text-[11px] text-amber-700 mt-1">{row.lookupError}</p>
                  )}
                  {row.product && (
                    <p className="text-[11px] text-emerald-700 mt-1">
                      {[row.product.name || row.product.product_type, row.product.category,
                        row.product.fabric].filter(Boolean).join(' · ')} — filled from the catalogue
                    </p>
                  )}
                </div>
                <Field label="Size"   value={row.size}   onChange={v => setRow(i, { size: v })} />
                <Field label="Colour" value={row.colour} onChange={v => setRow(i, { colour: v })} />
                <Field label="Pieces" value={row.pieces} onChange={v => setRow(i, { pieces: v })}
                       type="number" inputMode="numeric" min="1" />
                <Field label="Rate (₹) — optional" value={row.rate} onChange={v => setRow(i, { rate: v })}
                       type="number" inputMode="decimal" min="0" placeholder="Leave blank" />
                <Field label="Customization" value={row.customization}
                       onChange={v => setRow(i, { customization: v })}
                       placeholder="Alterations, notes…" className="col-span-2" />
              </div>

              {row.rate.trim() !== '' && (
                <div className="flex justify-between items-center pt-1 border-t border-slate-100">
                  <span className="text-[11px] text-slate-400">Line amount</span>
                  <span className="text-sm font-bold text-slate-800">{money(lineAmount(row))}</span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        <Button variant="outline" onClick={addRow} className="w-full gap-2 h-11 border-dashed">
          <Plus className="w-4 h-4" /> Add another item
        </Button>

        {/* Notes */}
        <label className="block text-xs">
          <span className="text-slate-500 font-medium">Order notes (optional)</span>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm resize-none"
            placeholder="Anything to record against this order"
          />
        </label>

        {/* Running totals. Slab, advance and coupons are chosen on the next
            step, so this card deliberately shows no coupon figure yet. */}
        <Card className="border-slate-200 bg-white">
          <CardContent className="p-4 space-y-2">
            {anyPriced ? (
              <Row label="Items total" value={money(orderTotal)} bold />
            ) : (
              <p className="text-[11px] text-slate-400">
                No rates entered — the order value comes from the slab you pick next.
              </p>
            )}
            {priorTotal > 0 && (
              <Row label={`Existing orders (${existing?.order_count})`} value={money(priorTotal)} muted />
            )}
            <div className="flex items-center gap-2 pt-2 mt-1 border-t border-slate-100">
              <Ticket className="w-3.5 h-3.5 text-slate-300 shrink-0" />
              <span className="text-[11px] text-slate-400">
                Next: choose the value slab and record the advance — coupons follow the advance taken.
              </span>
            </div>
          </CardContent>
        </Card>

        <motion.div whileTap={{ scale: 0.99 }}>
          <Button onClick={save} disabled={saving} className="w-full h-12 gap-2 text-sm font-semibold">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingBag className="w-4 h-4" />}
            {saving ? 'Creating…' : 'Continue to payment'}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, type = 'text', placeholder, className = '', inputMode, min,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
  inputMode?: 'numeric' | 'decimal';
  min?: string;
}) {
  return (
    <label className={`text-xs ${className}`}>
      <span className="text-slate-500 font-medium">{label}</span>
      <input
        type={type}
        inputMode={inputMode}
        min={min}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm"
      />
    </label>
  );
}

function Row({ label, value, bold, muted }: {
  label: string; value: string; bold?: boolean; muted?: boolean;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className={`text-xs ${muted ? 'text-slate-400' : 'text-slate-500'}`}>{label}</span>
      <span className={bold ? 'text-base font-bold text-slate-900' : 'text-sm text-slate-700'}>{value}</span>
    </div>
  );
}
