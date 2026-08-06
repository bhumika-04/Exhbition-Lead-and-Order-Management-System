'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Loader2, FileText, CheckCircle2, Ticket, Send,
  AlertTriangle, Download, Check,
} from 'lucide-react';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';
import type { OrderDetail, SlabOption } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  money, couponsForAdvance, ADVANCE_PER_SLAB,
  ORDER_STATUS_LABELS, ORDER_STATUS_STYLES,
} from '@/lib/orders';

export default function OrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const orderId = parseInt(params.id as string);

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [slabs, setSlabs] = useState<SlabOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);

  // Payment step state
  const [slab, setSlab] = useState(0);
  const [advance, setAdvance] = useState('');

  const load = async () => {
    try {
      const o = await api.getOrder(orderId);
      setOrder(o);
      setSlab(o.slab_band);
      setAdvance(o.advance_amount > 0 ? String(o.advance_amount) : '');
    } catch {
      toast.error('Could not load order');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/auth/login'); return; }
    load();
    api.getOrderSlabs(8).then(setSlabs).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // Picking a slab pre-fills the suggested advance. It stays editable —
  // the customer may pay less, and coupons follow what is actually taken.
  const pickSlab = (option: SlabOption) => {
    setSlab(option.slab);
    setAdvance(String(option.suggested_advance));
  };

  const advanceNum = (() => {
    const n = parseFloat(advance);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  })();

  // Coupons are a lead-level figure: this order's advance replaces whatever it
  // previously contributed to the lead's running total.
  const otherAdvance = order ? order.lead_summary.total_advance - order.advance_amount : 0;
  const projectedCoupons = couponsForAdvance(Math.max(0, otherAdvance) + advanceNum);
  const currentCoupons = order?.lead_summary.coupons ?? 0;

  const paymentDirty =
    !!order && (slab !== order.slab_band || advanceNum !== order.advance_amount);

  const savePayment = async () => {
    setSavingPayment(true);
    try {
      const res = await api.setOrderPayment(orderId, {
        slab_band: slab,
        order_value: null,
        advance_amount: advanceNum,
      });
      setOrder(res.order);
      toast.success('Payment saved');
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not save payment');
    } finally {
      setSavingPayment(false);
    }
  };

  const confirm = async () => {
    if (paymentDirty) { toast.error('Save the payment details first'); return; }
    setConfirming(true);
    try {
      const res = await api.confirmOrder(orderId);
      setOrder(res.order);

      // The order confirms even when the PDF or WhatsApp step fails, so report
      // each outcome separately instead of one blanket success.
      if (res.so_pdf?.error) toast.error(`Sales Order PDF failed: ${res.so_pdf.error}`);

      if (res.whatsapp?.sent) {
        toast.success('Order confirmed · WhatsApp sent');
      } else if (res.whatsapp?.status === 'skipped') {
        toast.success('Order confirmed');
        toast(`WhatsApp not sent — ${res.whatsapp.error ?? 'not configured'}`, { icon: 'ℹ️' });
      } else {
        toast.success('Order confirmed');
        toast.error(`WhatsApp failed — ${res.whatsapp?.error ?? 'unknown error'}`);
      }
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not confirm order');
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
        <AlertTriangle className="w-8 h-8" />
        <p className="text-sm">Order not found</p>
      </div>
    );
  }

  const s = order.lead_summary;
  const isConfirmed = order.status_code === 'confirmed';
  const isCancelled = order.status_code === 'cancelled';
  const pdfUrl = order.so_pdf_path ? api.uploadUrl(order.so_pdf_path) : null;
  const hasPricedLines = order.items.some(i => i.amount != null);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex items-center gap-3 shrink-0">
        <button onClick={() => router.back()} className="p-1.5 -ml-1.5 rounded-lg hover:bg-slate-100">
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-900 truncate">{order.order_number}</p>
          <p className="text-[11px] text-slate-400 truncate">
            {order.lead_name}{order.lead_company_name ? ` · ${order.lead_company_name}` : ''}
          </p>
        </div>
        <span className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${ORDER_STATUS_STYLES[order.status_code]}`}>
          {ORDER_STATUS_LABELS[order.status_code]}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5 space-y-4">
        {/* Items */}
        <Card className="border-slate-200">
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                Items ({order.items.length})
              </p>
            </div>
            <div className="divide-y divide-slate-100">
              {order.items.map(item => (
                <div key={item.order_item_id} className="px-4 py-3 flex justify-between items-start gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{item.item_type}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {[
                        item.barcode && `Barcode ${item.barcode}`,
                        item.size && `Size ${item.size}`,
                        item.colour,
                      ].filter(Boolean).join(' · ') || '—'}
                    </p>
                    {item.customization && (
                      <p className="text-[11px] text-slate-500 italic mt-1">{item.customization}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    {item.amount != null ? (
                      <>
                        <p className="text-sm font-bold text-slate-900">{money(item.amount)}</p>
                        <p className="text-[11px] text-slate-400">{item.pieces} × {money(item.rate ?? 0)}</p>
                      </>
                    ) : (
                      <p className="text-[11px] text-slate-400">{item.pieces} pc</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Step 2 — slab, advance, coupons */}
        {!isCancelled && (
          <Card className="border-slate-200">
            <CardContent className="p-4 space-y-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Order value slab
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Picks the suggested advance. Coupons follow what you actually collect.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {slabs.map(opt => {
                  const active = slab === opt.slab;
                  return (
                    <button
                      key={opt.slab}
                      onClick={() => pickSlab(opt)}
                      disabled={isConfirmed}
                      className={`rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${
                        active
                          ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-800">
                          {money(opt.from_value)}–{money(opt.to_value)}
                        </span>
                        {active && <Check className="w-3 h-3 text-blue-600 shrink-0" />}
                      </div>
                      <span className="text-[10px] text-slate-500">
                        advance {money(opt.suggested_advance)} · {opt.coupons_if_paid} coupons
                      </span>
                    </button>
                  );
                })}
                <button
                  onClick={() => { setSlab(0); setAdvance(''); }}
                  disabled={isConfirmed}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${
                    slab === 0
                      ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-800">Below {money(100000)}</span>
                    {slab === 0 && <Check className="w-3 h-3 text-blue-600 shrink-0" />}
                  </div>
                  <span className="text-[10px] text-slate-500">advance entered manually</span>
                </button>
              </div>

              <div>
                <label className="text-xs">
                  <span className="text-slate-500 font-medium">Advance received (₹)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={advance}
                    disabled={isConfirmed}
                    onChange={e => setAdvance(e.target.value)}
                    placeholder="0"
                    className="mt-1 w-full h-11 px-3 rounded-lg border border-slate-200 bg-white text-base font-semibold disabled:bg-slate-50"
                  />
                </label>
                {slab > 0 && advanceNum !== ADVANCE_PER_SLAB * slab && (
                  <p className="text-[11px] text-amber-700 mt-1">
                    Slab suggests {money(ADVANCE_PER_SLAB * slab)} — you have entered {money(advanceNum)}.
                  </p>
                )}
              </div>

              {/* Live coupon feedback — the whole point of the editable advance */}
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200">
                <Ticket className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="text-xs font-bold text-amber-800">
                  {projectedCoupons} lucky-draw coupon{projectedCoupons === 1 ? '' : 's'}
                </span>
                {projectedCoupons !== currentCoupons && (
                  <span className="text-[10px] text-amber-700 ml-auto">
                    was {currentCoupons}
                  </span>
                )}
              </div>

              {!isConfirmed && (
                <Button
                  variant={paymentDirty ? 'default' : 'outline'}
                  onClick={savePayment}
                  disabled={savingPayment || !paymentDirty}
                  className="w-full h-10 gap-2 text-xs"
                >
                  {savingPayment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {paymentDirty ? 'Save payment details' : 'Payment details saved'}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Lead-level position */}
        <Card className="border-slate-200">
          <CardContent className="p-4 space-y-2">
            {hasPricedLines && <Row label="Items total" value={money(order.order_total)} />}
            <Row label={s.order_count > 1 ? `Value across ${s.order_count} orders` : 'Order value'}
                 value={money(s.lead_total)} bold />
            <Row label="Advance received" value={money(s.total_advance)} />
            <Row label="Balance due" value={money(s.balance)} />
            {s.is_overpaid && (
              <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                Advance exceeds the order value — check the figures.
              </p>
            )}
            {s.order_count > 1 && (
              <p className="text-[10px] text-slate-400 leading-snug pt-1">
                Coupons are calculated on this customer&apos;s combined advance, not per order.
              </p>
            )}
          </CardContent>
        </Card>

        {order.notes && (
          <Card className="border-slate-200">
            <CardContent className="p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Notes</p>
              <p className="text-sm text-slate-700">{order.notes}</p>
            </CardContent>
          </Card>
        )}

        <div className="space-y-2">
          {!isConfirmed && !isCancelled && (
            <motion.div whileTap={{ scale: 0.99 }}>
              <Button onClick={confirm} disabled={confirming || paymentDirty}
                      className="w-full h-12 gap-2 text-sm font-semibold">
                {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {confirming ? 'Confirming…' : 'Confirm & Send Sales Order'}
              </Button>
            </motion.div>
          )}

          {isConfirmed && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="text-xs font-semibold text-emerald-800">
                Confirmed
                {order.confirmed_at
                  ? ` · ${new Date(order.confirmed_at).toLocaleDateString('en-IN', {
                      day: '2-digit', month: 'short', year: 'numeric',
                    })}`
                  : ''}
              </span>
            </div>
          )}

          {pdfUrl && (
            <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="block">
              <Button variant="outline" className="w-full h-11 gap-2 text-sm">
                <FileText className="w-4 h-4" /> View Sales Order PDF
                <Download className="w-3.5 h-3.5 ml-auto text-slate-400" />
              </Button>
            </a>
          )}

          {isConfirmed && !pdfUrl && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No Sales Order PDF on file — generation failed during confirmation.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={bold ? 'text-base font-bold text-slate-900' : 'text-sm text-slate-700'}>{value}</span>
    </div>
  );
}
