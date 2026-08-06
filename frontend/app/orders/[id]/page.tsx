'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Loader2, FileText, CheckCircle2, Ticket, Send,
  AlertTriangle, Download, Pencil,
} from 'lucide-react';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';
import type { OrderDetail } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { money, ADVANCE_BAND_SIZE, ORDER_STATUS_LABELS, ORDER_STATUS_STYLES } from '@/lib/orders';

export default function OrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const orderId = parseInt(params.id as string);

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [savingAdvance, setSavingAdvance] = useState(false);
  const [manualAdvance, setManualAdvance] = useState('');

  const load = async () => {
    try {
      const o = await api.getOrder(orderId);
      setOrder(o);
      setManualAdvance(
        o.lead_summary.manual_advance_amount != null
          ? String(o.lead_summary.manual_advance_amount)
          : ''
      );
    } catch {
      toast.error('Could not load order');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/auth/login'); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const confirm = async () => {
    setConfirming(true);
    try {
      const res = await api.confirmOrder(orderId);
      setOrder(res.order);

      // The order is confirmed even when the PDF or WhatsApp step fails, so
      // report each outcome separately rather than a single success toast.
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

  const saveManualAdvance = async () => {
    const raw = manualAdvance.trim();
    const amount = raw === '' ? null : parseFloat(raw);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      toast.error('Enter a valid advance amount');
      return;
    }
    setSavingAdvance(true);
    try {
      await api.setManualAdvance(order!.lead_id, amount);
      toast.success('Advance updated');
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not update advance');
    } finally {
      setSavingAdvance(false);
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
  const pdfUrl = order.so_pdf_path ? api.uploadUrl(order.so_pdf_path) : null;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50">
      {/* Header */}
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
                <div key={item.order_item_id} className="px-4 py-3">
                  <div className="flex justify-between items-start gap-3">
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
                      <p className="text-sm font-bold text-slate-900">{money(item.amount)}</p>
                      <p className="text-[11px] text-slate-400">
                        {item.pieces} × {money(item.rate)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Money */}
        <Card className="border-slate-200">
          <CardContent className="p-4 space-y-2">
            <Row label="This order" value={money(order.order_total)} />
            {s.order_count > 1 && (
              <>
                <Row label={`Total across ${s.order_count} orders`} value={money(s.lead_total)} bold />
                <p className="text-[10px] text-slate-400 leading-snug">
                  Advance and coupons are calculated on this customer&apos;s combined value, not on a single order.
                </p>
              </>
            )}
            <div className="border-t border-slate-100 pt-2 space-y-2">
              <Row label="Advance" value={money(s.advance)} bold />
              <Row label="Balance due" value={money(s.balance)} />
            </div>

            {s.band > 0 ? (
              <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                <Ticket className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="text-xs font-semibold text-amber-700">
                  {s.coupons} lucky-draw coupon{s.coupons === 1 ? '' : 's'}
                </span>
                <span className="text-[10px] text-slate-400 ml-auto">Band {s.band}</span>
              </div>
            ) : (
              /* Below ₹1L there is no band: no coupons, operator sets the advance. */
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <p className="text-[11px] text-slate-500">
                  Below {money(ADVANCE_BAND_SIZE)} — no coupons. Set the agreed advance:
                </p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={manualAdvance}
                    onChange={e => setManualAdvance(e.target.value)}
                    placeholder="0"
                    className="flex-1 h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm"
                  />
                  <Button
                    variant="outline"
                    onClick={saveManualAdvance}
                    disabled={savingAdvance}
                    className="h-10 gap-1.5 px-4 text-xs"
                  >
                    {savingAdvance ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pencil className="w-3.5 h-3.5" />}
                    Save
                  </Button>
                </div>
              </div>
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

        {/* Actions */}
        <div className="space-y-2">
          {!isConfirmed && order.status_code !== 'cancelled' && (
            <motion.div whileTap={{ scale: 0.99 }}>
              <Button onClick={confirm} disabled={confirming} className="w-full h-12 gap-2 text-sm font-semibold">
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
              No Sales Order PDF on file — generation failed during confirmation. Re-confirming will retry it.
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
