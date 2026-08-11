'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Loader2, FileText, CheckCircle2, Ticket, Send,
  AlertTriangle, Download, Check, X, ImageIcon, Pencil, Camera, Upload, Receipt,
} from 'lucide-react';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';
import { useIsMobile } from '@/lib/useIsMobile';
import type { OrderDetail, SlabOption } from '@/lib/types';
import { NumberInput } from '@/components/ui/number-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import LeadCouponsCard from '@/components/LeadCouponsCard';
import CameraDialog from '@/components/CameraDialog';
import {
  money, couponsFor, couponsForSlab, slabForValue, ADVANCE_PER_SLAB, SLAB_SIZE,
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
  const [showSlabPicker, setShowSlabPicker] = useState(false);
  /**
   * True once the operator sets the advance themselves, by typing or by
   * choosing a slab. The autofill must never overwrite it — the advance is
   * what was actually collected at the counter; the slab only suggests it.
   */
  const [advanceEdited, setAdvanceEdited] = useState(false);

  // Payment proof
  const isMobile = useIsMobile();
  const [proofBusy, setProofBusy] = useState(false);
  const [showProofChoice, setShowProofChoice] = useState(false);
  const [showProofCamera, setShowProofCamera] = useState(false);
  const [webcamAvailable, setWebcamAvailable] = useState(false);
  const proofCamRef = useRef<HTMLInputElement>(null);
  const proofFileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setWebcamAvailable(typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia);
  }, []);

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

  const uploadProof = async (file: File) => {
    setProofBusy(true);
    try {
      await api.uploadPaymentProof(orderId, file);
      toast.success('Payment proof saved');
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not upload the payment proof');
    } finally {
      setProofBusy(false);
    }
  };

  // Picking a slab pre-fills the suggested advance. It stays editable —
  // the customer may pay less, and coupons follow what is actually taken.
  //
  // Counts as an edit: choosing a slab by hand is a deliberate override, and
  // the advance that came with it should survive a later re-derivation.
  const pickSlab = (option: SlabOption) => {
    setSlab(option.slab);
    setAdvance(String(option.suggested_advance));
    setAdvanceEdited(true);
  };

  /**
   * The slab this order actually falls in, derived from its value.
   *
   * Null when the items carry no prices — there is nothing to derive from, so
   * the operator has to choose and the full picker is shown instead.
   */
  const derivedSlab = (() => {
    const value = order?.effective_value ?? 0;
    if (!order || value <= 0) return null;
    const n = slabForValue(value);
    return {
      slab: n,
      from: n * SLAB_SIZE,
      to: (n + 1) * SLAB_SIZE,
      suggested: n * ADVANCE_PER_SLAB,
      coupons: couponsForSlab(n),
    };
  })();

  /**
   * Derived here rather than after the early returns below.
   *
   * The effect underneath reads this, and a `const` declared past an early
   * return is not initialised on any render that takes that path — saving the
   * payment calls load(), which flips `loading` back on while `order` is still
   * set, so the component returned at "if (loading)" and the effect then threw
   * a temporal-dead-zone ReferenceError. A thrown effect abandons the rest of
   * its body, which is why the slab and its suggested advance stopped being
   * applied at all.
   */
  const isConfirmed = order?.status_code === 'confirmed';

  // Opening a different order starts clean.
  useEffect(() => { setAdvanceEdited(false); }, [order?.order_id]);

  // Keep the slab and its suggested advance in step with the order's value, so
  // the operator only ever confirms a figure rather than deriving the band by
  // hand. Re-runs when the value changes — editing the items moves the slab,
  // and a suggestion left over from the old total would be wrong.
  useEffect(() => {
    if (!order || derivedSlab === null || isConfirmed) return;
    setSlab(derivedSlab.slab);
    // An advance the operator has touched, or one already banked against the
    // order, is real money and stands.
    if (advanceEdited || order.advance_amount > 0) return;
    setAdvance(derivedSlab.suggested > 0 ? String(derivedSlab.suggested) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.order_id, order?.effective_value]);

  const advanceNum = (() => {
    const n = parseFloat(advance);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  })();

  // Coupons are a lead-level figure: this order's advance replaces whatever it
  // previously contributed to the lead's running total.
  const otherAdvance = order ? order.lead_summary.total_advance - order.advance_amount : 0;
  const projectedCoupons = couponsFor(
    order?.lead_summary.lead_total ?? 0,
    Math.max(0, otherAdvance) + advanceNum,
  );
  const currentCoupons = order?.lead_summary.coupons ?? 0;

  /**
   * An advance above the order's value is money the customer does not owe on
   * this order — almost always a stray zero. Blocked rather than warned about,
   * because the advance drives the coupon count and would hand out lucky-draw
   * entries nobody paid for. The server refuses it too.
   */
  const orderValue = order?.effective_value ?? 0;
  const advanceTooHigh = orderValue > 0 && advanceNum > orderValue;

  const paymentDirty =
    !!order && (slab !== order.slab_band || advanceNum !== order.advance_amount);

  const savePayment = async () => {
    if (advanceTooHigh) { toast.error('Advance cannot be more than the order value'); return; }
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
    if (advanceTooHigh) { toast.error('Advance cannot be more than the order value'); return; }

    // Save first rather than refusing. The button used to be disabled whenever
    // the slab or advance differed from what was stored — and the derived slab
    // is applied automatically on load, so a fresh draft opened with Confirm
    // already dead and nothing on screen saying why.
    if (paymentDirty) {
      try {
        await api.setOrderPayment(orderId, {
          slab_band: slab,
          order_value: null,
          advance_amount: advanceNum,
        });
      } catch (err: any) {
        toast.error(err.response?.data?.error || 'Could not save the payment details');
        return;
      }
    }

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
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground/50" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <AlertTriangle className="w-8 h-8" />
        <p className="text-sm">Order not found</p>
      </div>
    );
  }

  const s = order.lead_summary;
  const isCancelled = order.status_code === 'cancelled';
  const pdfUrl = order.so_pdf_path ? api.uploadUrl(order.so_pdf_path) : null;
  const hasPricedLines = order.items.some(i => i.amount != null);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      <div className="bg-card border-b border-border px-4 md:px-6 py-3 flex items-center gap-3 shrink-0">
        <button onClick={() => router.back()} className="p-1.5 -ml-1.5 rounded-lg hover:bg-secondary">
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground truncate">{order.order_number}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {order.lead_name}{order.lead_company_name ? ` · ${order.lead_company_name}` : ''}
          </p>
        </div>
        {!isConfirmed && !isCancelled && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/leads/${order.lead_id}/orders/new?edit=${order.order_id}`)}
            className="h-8 gap-1.5 text-xs shrink-0"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Edit items</span>
          </Button>
        )}
        <span className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${ORDER_STATUS_STYLES[order.status_code]}`}>
          {ORDER_STATUS_LABELS[order.status_code]}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5 space-y-4">
        {/* Items */}
        <Card className="border-border">
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b border-border">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Items ({order.items.length})
              </p>
            </div>
            <div className="divide-y divide-border">
              {order.items.map(item => (
                <div key={item.order_item_id} className="px-4 py-3 flex items-start gap-3">
                  {/* The local upload wins — it is the copy the Sales Order PDF
                      embeds, so the screen matches the customer's document. */}
                  <div className="w-14 h-16 rounded-lg bg-secondary shrink-0 overflow-hidden flex items-center justify-center">
                    {item.product_image_path || item.product_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.product_image_path
                          ? api.uploadUrl(item.product_image_path)
                          : item.product_image_url!}
                        alt={item.barcode ?? `Line ${item.line_number}`}
                        className="w-full h-full object-cover"
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <ImageIcon className="w-4 h-4 text-muted-foreground/50" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{item.barcode || `Line ${item.line_number}`}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {[
                        item.barcode && `Barcode ${item.barcode}`,
                        item.size && `Size ${item.size}`,
                        item.colour,
                      ].filter(Boolean).join(' · ') || '—'}
                    </p>
                    {item.customization && (
                      <p className="text-[11px] text-muted-foreground italic mt-1">{item.customization}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    {item.amount != null ? (
                      <>
                        <p className="text-sm font-bold text-foreground">{money(item.amount)}</p>
                        <p className="text-[11px] text-muted-foreground">{item.pieces} × {money(item.rate ?? 0)}</p>
                      </>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">{item.pieces} pc</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Step 2 — slab, advance, coupons */}
        {!isCancelled && (
          <Card className="border-border">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    Order value slab
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Sets the suggested advance. Coupons follow what you actually collect.
                  </p>
                </div>
                {!isConfirmed && (
                  <button onClick={() => setShowSlabPicker(true)}
                          className="text-[11px] text-primary hover:underline shrink-0 pt-0.5">
                    Change
                  </button>
                )}
              </div>

              {/* When the items carry prices the slab is a fact, not a choice —
                  show the one this order falls in rather than a wall of options
                  the operator has to match against the total themselves. */}
              {derivedSlab !== null ? (
                <div className="rounded-xl border border-primary/30 bg-primary/[0.07] ring-1 ring-ring/30 px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="text-sm font-bold text-foreground">
                      {derivedSlab.slab === 0
                        ? `Below ${money(SLAB_SIZE)}`
                        : `${money(derivedSlab.from)}–${money(derivedSlab.to)}`}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {derivedSlab.slab === 0
                      ? 'No slab — enter the advance you agreed.'
                      : `Suggested advance ${money(derivedSlab.suggested)} · ${derivedSlab.coupons} coupons if paid in full`}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    From this order&apos;s value of {money(order.effective_value)}
                  </p>
                </div>
              ) : (
                // Slab is unknown (unpriced lines) — the current choice reads as
                // a summary line; the full list lives in the dialog.
                <button
                  onClick={() => setShowSlabPicker(true)}
                  disabled={isConfirmed}
                  className="w-full rounded-lg border border-border bg-card px-3 py-3 text-left
                             hover:border-input transition-colors disabled:opacity-60"
                >
                  <span className="text-sm font-semibold text-foreground">
                    {slab === 0 ? `Below ${money(SLAB_SIZE)}`
                                : `${money(SLAB_SIZE * slab)}–${money(SLAB_SIZE * (slab + 1))}`}
                  </span>
                  <span className="block text-[11px] text-muted-foreground mt-0.5">
                    {slab === 0 ? 'No slab — enter the advance you agreed'
                                : `Suggested advance ${money(ADVANCE_PER_SLAB * slab)} · ${couponsForSlab(slab)} coupons if paid in full`}
                  </span>
                  <span className="block text-[11px] text-primary mt-1">Change slab</span>
                </button>
              )}

              <div>
                <label className="text-xs">
                  <span className="text-muted-foreground font-medium">Advance received (₹)</span>
                  <NumberInput
                    mode="decimal"
                    value={advance}
                    disabled={isConfirmed}
                    onValueChange={v => { setAdvanceEdited(true); setAdvance(v); }}
                    placeholder={slab > 0 ? String(ADVANCE_PER_SLAB * slab) : '0'}
                    enterKeyHint="done"
                    className="mt-1 h-11 text-base font-semibold disabled:bg-secondary/60"
                  />
                </label>

                {advanceTooHigh && (
                  <p className="text-[11px] text-destructive mt-1.5">
                    More than the order value of {money(orderValue)}. Reduce it before saving.
                  </p>
                )}

                {/* Prefilled from the slab, but the counter can have collected
                    anything. Rather than just warn about the difference, offer
                    the suggested figure back as one tap — a warning the operator
                    cannot act on is only nagging. */}
                {!isConfirmed && !advanceTooHigh && slab > 0 && advanceNum !== ADVANCE_PER_SLAB * slab && (
                  <div className="flex items-center gap-2 mt-1.5">
                    <p className="text-[11px] text-warning flex-1 min-w-0">
                      Slab suggests {money(ADVANCE_PER_SLAB * slab)} — you have entered {money(advanceNum)}.
                    </p>
                    <button
                      type="button"
                      onClick={() => { setAdvanceEdited(true); setAdvance(String(ADVANCE_PER_SLAB * slab)); }}
                      className="shrink-0 h-6 px-2 rounded-md border border-warning/40 text-[11px]
                                 font-medium text-warning hover:bg-warning/10 transition-colors"
                    >
                      Use {money(ADVANCE_PER_SLAB * slab)}
                    </button>
                  </div>
                )}
              </div>

              {/* Live coupon feedback — the whole point of the editable advance */}
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-warning/[0.07] border border-warning/25">
                <Ticket className="w-4 h-4 text-warning shrink-0" />
                <span className="text-xs font-bold text-warning">
                  {projectedCoupons} lucky-draw coupon{projectedCoupons === 1 ? '' : 's'}
                </span>
                {projectedCoupons !== currentCoupons && (
                  <span className="text-[10px] text-warning ml-auto">
                    was {currentCoupons}
                  </span>
                )}
              </div>

              {/* Payment proof — a photo or screenshot of the receipt for the
                  advance actually collected. Same take-photo-or-upload choice
                  as a lead's team photo. */}
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-border">
                {order.payment_proof_path ? (
                  order.payment_proof_path.toLowerCase().endsWith('.pdf') ? (
                    <a href={api.uploadUrl(order.payment_proof_path)} target="_blank" rel="noopener noreferrer"
                       className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                    </a>
                  ) : (
                    <a href={api.uploadUrl(order.payment_proof_path)} target="_blank" rel="noopener noreferrer"
                       className="w-10 h-10 rounded-lg overflow-hidden bg-secondary shrink-0 block">
                      <img src={api.uploadUrl(order.payment_proof_path)} alt="Payment proof" className="w-full h-full object-cover" />
                    </a>
                  )
                ) : (
                  <span className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                    <Receipt className="w-4 h-4 text-muted-foreground/50" />
                  </span>
                )}
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-semibold text-foreground">Payment proof</span>
                  <span className="block text-[11px] text-muted-foreground truncate">
                    {order.payment_proof_path ? 'Receipt saved — tap to view' : 'Not added yet'}
                  </span>
                </span>
                <Button size="sm" variant="outline" disabled={proofBusy}
                        onClick={() => setShowProofChoice(true)}
                        className="h-8 gap-1.5 text-xs shrink-0">
                  {proofBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {order.payment_proof_path ? 'Replace' : 'Add'}
                </Button>
              </div>

              {!isConfirmed && (
                <Button
                  variant={paymentDirty ? 'default' : 'outline'}
                  onClick={savePayment}
                  disabled={savingPayment || !paymentDirty || advanceTooHigh}
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
        <Card className="border-border">
          <CardContent className="p-4 space-y-2">
            {hasPricedLines && <Row label="Items total" value={money(order.order_total)} />}
            <Row label={s.order_count > 1 ? `Value across ${s.order_count} orders` : 'Order value'}
                 value={money(s.lead_total)} bold />
            <Row label="Advance received" value={money(s.total_advance)} />
            <Row label="Balance due" value={money(s.balance)} />
            {s.is_overpaid && (
              <p className="text-[11px] text-destructive bg-destructive/[0.07] border border-destructive/25 rounded-lg px-3 py-2">
                Advance exceeds the order value — check the figures.
              </p>
            )}
            {s.order_count > 1 && (
              <p className="text-[10px] text-muted-foreground leading-snug pt-1">
                Coupons are calculated on this customer&apos;s combined advance, not per order.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Same admin override + coupon-number recording as the lead page —
            coupons are a lead-level figure, so this reaches the same lead
            record whether opened from here or from the lead itself. */}
        <LeadCouponsCard leadId={order.lead_id} />

        {order.notes && (
          <Card className="border-border">
            <CardContent className="p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Notes</p>
              <p className="text-sm text-foreground">{order.notes}</p>
            </CardContent>
          </Card>
        )}

        <div className="space-y-2">
          {!isConfirmed && !isCancelled && (
            <motion.div whileTap={{ scale: 0.99 }}>
              <Button onClick={confirm} disabled={confirming || advanceTooHigh}
                      className="w-full h-12 gap-2 text-sm font-semibold">
                {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {confirming ? 'Confirming…' : 'Confirm & Send Sales Order'}
              </Button>
              {paymentDirty && (
                <p className="text-[11px] text-muted-foreground text-center mt-1.5">
                  Unsaved payment details will be saved as part of confirming.
                </p>
              )}
            </motion.div>
          )}

          {isConfirmed && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-success/[0.07] border border-success/25">
              <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
              <span className="text-xs font-semibold text-success">
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
                <Download className="w-3.5 h-3.5 ml-auto text-muted-foreground" />
              </Button>
            </a>
          )}

          {isConfirmed && !pdfUrl && (
            <p className="text-[11px] text-warning bg-warning/[0.07] border border-warning/25 rounded-lg px-3 py-2">
              No Sales Order PDF on file — generation failed during confirmation.
            </p>
          )}
        </div>
      </div>

      {/* Slab picker — a dialog rather than a grid of every band inline. The
          list is unbounded (20 slabs from the API), so inline it pushed the
          advance field and the Confirm button off the screen. */}
      <AnimatePresence>
        {showSlabPicker && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowSlabPicker(false)}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4"
          >
            <motion.div
              initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
              onClick={e => e.stopPropagation()}
              className="bg-card w-full sm:max-w-md rounded-t-2xl sm:rounded-xl border border-border
                         shadow-lg max-h-[80vh] flex flex-col overflow-hidden"
            >
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">Order value slab</h3>
                  <p className="text-[11px] text-muted-foreground">
                    Sets the suggested advance — you can still edit it
                  </p>
                </div>
                <button onClick={() => setShowSlabPicker(false)} aria-label="Close"
                        className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="overflow-y-auto p-2">
                <SlabOptionRow
                  active={slab === 0}
                  title={`Below ${money(SLAB_SIZE)}`}
                  detail="No slab — advance entered by hand, and no coupons"
                  onClick={() => { setSlab(0); setAdvance(''); setShowSlabPicker(false); }}
                />
                {slabs.map(opt => (
                  <SlabOptionRow
                    key={opt.slab}
                    active={slab === opt.slab}
                    title={`${money(opt.from_value)}–${money(opt.to_value)}`}
                    detail={`Advance ${money(opt.suggested_advance)} · ${opt.coupons_if_paid} coupons if paid in full`}
                    onClick={() => { pickSlab(opt); setShowSlabPicker(false); }}
                  />
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Payment proof — take a photo or upload an existing one, same choice
          as a lead's team photo. */}
      <input
        ref={proofCamRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadProof(f); e.target.value = ''; }}
      />
      <input
        ref={proofFileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadProof(f); e.target.value = ''; }}
      />

      <AnimatePresence>
        {showProofChoice && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowProofChoice(false)}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-card w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold text-foreground">Add payment proof</p>
                <button onClick={() => setShowProofChoice(false)} className="p-1 rounded-lg hover:bg-secondary">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    setShowProofChoice(false);
                    if (isMobile || !webcamAvailable) proofCamRef.current?.click(); else setShowProofCamera(true);
                  }}
                  className="flex items-center gap-3 px-3 py-3 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors text-left"
                >
                  <span className="w-9 h-9 rounded-lg bg-card flex items-center justify-center shrink-0">
                    <Camera className="w-4 h-4 text-muted-foreground" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">Take photo</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {isMobile || !webcamAvailable ? 'Opens your camera' : 'Opens your webcam'}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => { setShowProofChoice(false); proofFileRef.current?.click(); }}
                  className="flex items-center gap-3 px-3 py-3 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors text-left"
                >
                  <span className="w-9 h-9 rounded-lg bg-card flex items-center justify-center shrink-0">
                    <Upload className="w-4 h-4 text-muted-foreground" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">Upload</span>
                    <span className="block text-[11px] text-muted-foreground">Photo, screenshot or PDF</span>
                  </span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <CameraDialog
        open={showProofCamera}
        title="Payment proof"
        onCapture={uploadProof}
        onClose={() => setShowProofCamera(false)}
      />
    </div>
  );
}

function SlabOptionRow({ active, title, detail, onClick }: {
  active: boolean; title: string; detail: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
        active ? 'bg-primary/[0.08]' : 'hover:bg-secondary/60'
      }`}
    >
      <span className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
        active ? 'border-primary bg-primary' : 'border-input'
      }`}>
        {active && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block text-sm ${active ? 'font-semibold text-primary' : 'text-foreground'}`}>
          {title}
        </span>
        <span className="block text-[11px] text-muted-foreground truncate">{detail}</span>
      </span>
    </button>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={bold ? 'text-base font-bold text-foreground' : 'text-sm text-foreground'}>{value}</span>
    </div>
  );
}
