'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Loader2, Check, X, Send, Ticket } from 'lucide-react';
import { api } from '@/lib/api';
import type { SlabOption } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { money, slabForValue, couponsFor, ADVANCE_PER_SLAB, SLAB_SIZE } from '@/lib/orders';

/**
 * The only fields the modal needs — satisfied by both OrderSummary (lead
 * detail page) and OrderListItem (Orders page), so either list can be passed
 * straight in with no adapting.
 */
export interface PayableOrder {
  order_id: number;
  status_code: string;
  effective_value: number;
  advance_amount: number;
}

/**
 * One payment, several drafts, confirmed together. The combined value drives
 * the slab picker the same way a single order's payment step does — the
 * customer is one person settling one bill, whether it came out of one order
 * or three. Also where the coupons this payment earns get their physical
 * numbers recorded, rather than sending the operator to a separate screen
 * right after they have just taken the money.
 *
 * Rendered via a portal to document.body: nested inside a BlurFade (or
 * anything else that sets filter/will-change), position: fixed resolves
 * against that ancestor instead of the viewport, trapping the modal inside
 * whatever card opened it instead of covering the screen.
 */
export default function BulkPaymentModal({ leadId, orders, onClose, onDone }: {
  leadId: number;
  orders: PayableOrder[];
  onClose: () => void;
  onDone: () => void;
}) {
  const combinedValue = orders.reduce((sum, o) => sum + o.effective_value, 0);

  // The combined value already says which slab this falls in — no reason to
  // make the operator match a total against a list of ranges by eye. `orders`
  // is a fixed snapshot for this modal's whole lifetime (it closes and a new
  // one opens on a fresh selection), so deriving once here needs no effect.
  const derivedSlab = combinedValue > 0 ? slabForValue(combinedValue) : 0;

  const [slabs, setSlabs] = useState<SlabOption[]>([]);
  const [slab, setSlab] = useState(derivedSlab);
  const [advance, setAdvance] = useState(derivedSlab > 0 ? String(derivedSlab * ADVANCE_PER_SLAB) : '');
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState(false);

  // Coupons are a lead-level figure (see LeadCouponsCard), so the count this
  // payment earns needs the lead's other orders too, not just this selection.
  const [leadTotal, setLeadTotal] = useState(0);
  const [otherAdvance, setOtherAdvance] = useState(0);
  const [currentCoupons, setCurrentCoupons] = useState(0);
  const [numbers, setNumbers] = useState<string[]>([]);
  const [numbersInput, setNumbersInput] = useState('');
  const [numbersBusy, setNumbersBusy] = useState(false);

  useEffect(() => {
    api.getOrderSlabs(8).then(setSlabs).catch(() => {});
    Promise.all([api.getLeadOrderSummary(leadId), api.getLead(leadId)])
      .then(([summary, lead]) => {
        setLeadTotal(summary.lead_total);
        setCurrentCoupons(summary.coupons);
        // These orders are drafts and so contribute nothing to the lead's
        // advance yet — but if one was ever hand-set via a single order's
        // payment step without confirming, that stray figure is still in
        // the lead total and must be backed out before adding this payment.
        setOtherAdvance(Math.max(0, summary.total_advance - orders.reduce((s, o) => s + o.advance_amount, 0)));
        try { setNumbers(lead.coupon_numbers ? JSON.parse(lead.coupon_numbers) : []); } catch { setNumbers([]); }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  const advanceNumber = parseFloat(advance);
  const advanceValid = Number.isFinite(advanceNumber) && advanceNumber >= 0;
  const advanceTooHigh = advanceValid && advanceNumber > combinedValue;

  const projectedCoupons = couponsFor(leadTotal, otherAdvance + (advanceValid ? advanceNumber : 0));

  const pickSlab = (opt: SlabOption) => {
    setSlab(opt.slab);
    setAdvance(String(opt.suggested_advance));
    setShowPicker(false);
  };

  const submit = async () => {
    if (!advanceValid || advanceTooHigh) return;
    setBusy(true);
    try {
      const res = await api.bulkConfirmDrafts(leadId, {
        order_ids: orders.map(o => o.order_id),
        slab_band: slab,
        advance_amount: advanceNumber,
      });
      const failedWhatsApp = res.confirmed.filter(c => !c.whatsapp.sent).length;
      toast.success(
        `${res.confirmed.length} order${res.confirmed.length === 1 ? '' : 's'} confirmed` +
        (failedWhatsApp > 0 ? ` — WhatsApp didn't send for ${failedWhatsApp}` : '')
      );
      onDone();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not confirm these orders');
    } finally {
      setBusy(false);
    }
  };

  const saveNumbers = async () => {
    const entered = numbersInput.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    const combined = Array.from(new Set([...numbers, ...entered]));
    if (combined.length === numbers.length && entered.length === 0) return;
    // Can't record more physical coupons than this payment actually earns —
    // typing past it would hand out lucky-draw entries nothing backs.
    if (combined.length > projectedCoupons) {
      toast.error(`This payment earns ${projectedCoupons} coupon${projectedCoupons === 1 ? '' : 's'} — that's ${combined.length - projectedCoupons} too many.`);
      return;
    }
    setNumbersBusy(true);
    try {
      const saved = await api.setLeadCouponNumbers(leadId, combined);
      setNumbers(saved);
      setNumbersInput('');
      toast.success('Coupon numbers saved');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not save the coupon numbers');
    } finally {
      setNumbersBusy(false);
    }
  };

  const removeNumber = async (n: string) => {
    setNumbersBusy(true);
    try {
      const saved = await api.setLeadCouponNumbers(leadId, numbers.filter(x => x !== n));
      setNumbers(saved);
    } catch {
      toast.error('Could not remove that number');
    } finally {
      setNumbersBusy(false);
    }
  };

  return createPortal(
    <div onClick={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div onClick={e => e.stopPropagation()} className="bg-card w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl max-h-[85vh] overflow-y-auto">
        <div className="sticky top-0 bg-card flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <p className="text-sm font-bold text-foreground">Payment for {orders.length} orders</p>
            <p className="text-[11px] text-muted-foreground">Combined value {money(combinedValue)}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-secondary">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <div className="flex items-start gap-2 mb-1.5">
              <p className="text-[11px] font-medium text-muted-foreground flex-1">
                Combined value slab — sets the suggested advance
              </p>
              {/* Manual override stays reachable for the rare case (e.g.
                  collecting against a figure the customer negotiated), but the
                  value already says which slab this falls in, so that is what
                  shows by default rather than a list to match by eye. */}
              <button type="button" onClick={() => setShowPicker(s => !s)}
                      className="text-[11px] text-primary hover:underline shrink-0">
                {showPicker ? 'Hide' : 'Change'}
              </button>
            </div>

            {!showPicker ? (
              <div className="rounded-xl border border-primary/30 bg-primary/[0.07] px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="text-sm font-bold text-foreground">
                    {slab === 0 ? `Below ${money(SLAB_SIZE)}` : `${money(slab * SLAB_SIZE)}–${money((slab + 1) * SLAB_SIZE)}`}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {slab === 0
                    ? 'No slab — enter the advance you agreed.'
                    : `Suggested advance ${money(slab * ADVANCE_PER_SLAB)}`}
                </p>
              </div>
            ) : (
              <div className="space-y-1 rounded-lg border border-border p-1.5">
                {slabs.map(opt => (
                  <button
                    key={opt.slab}
                    onClick={() => pickSlab(opt)}
                    className={`w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                      slab === opt.slab ? 'bg-primary/[0.08]' : 'hover:bg-secondary/60'
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                      slab === opt.slab ? 'border-primary bg-primary' : 'border-input'
                    }`}>
                      {slab === opt.slab && <Check className="w-2 h-2 text-primary-foreground" />}
                    </span>
                    <span className="flex-1 min-w-0 text-xs text-foreground">
                      {money(opt.from_value)}–{money(opt.to_value)}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      Advance {money(opt.suggested_advance)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="block">
            <span className="text-[11px] font-medium text-muted-foreground">Advance actually collected</span>
            <input
              type="number" min={0} value={advance}
              onChange={e => setAdvance(e.target.value)}
              placeholder="0"
              className="mt-1 w-full h-10 px-3 rounded-lg border border-border text-sm"
            />
            {advanceTooHigh && (
              <span className="text-[11px] text-destructive">
                More than the combined value of {money(combinedValue)}
              </span>
            )}
          </label>

          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Split across the {orders.length} orders behind the scenes, each up to its own value —
            the balance and coupons this customer sees only ever look at the combined total.
          </p>

          {/* Live coupon feedback, same figure the lead page will show once
              this payment saves — number of tokens this payment allots. */}
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-warning/[0.07] border border-warning/25">
            <Ticket className="w-4 h-4 text-warning shrink-0" />
            <span className="text-xs font-bold text-warning">
              {projectedCoupons} lucky-draw coupon{projectedCoupons === 1 ? '' : 's'}
            </span>
            {projectedCoupons !== currentCoupons && (
              <span className="text-[10px] text-warning ml-auto">was {currentCoupons}</span>
            )}
          </div>

          {/* Physical coupon numbers — recorded here rather than sending the
              operator to the lead page right after taking the payment. Same
              save-by-merge behaviour as LeadCouponsCard: entering more adds
              to what is already on file rather than replacing it. */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground">Physical coupon numbers</p>
            {numbers.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {numbers.map(n => (
                  <span key={n} className="inline-flex items-center gap-1 bg-secondary text-foreground rounded-lg pl-2.5 pr-1 py-1 text-[11px]">
                    {n}
                    <button onClick={() => removeNumber(n)} disabled={numbersBusy} aria-label={`Remove ${n}`}
                            className="p-0.5 rounded hover:bg-card">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <input
                value={numbersInput} onChange={e => setNumbersInput(e.target.value)}
                placeholder="A-102, A-103 or one per line"
                className="flex-1 min-w-0 h-9 px-2.5 rounded-md border border-border text-xs"
              />
              <Button size="sm" variant="outline" disabled={numbersBusy || !numbersInput.trim()}
                      onClick={saveNumbers} className="h-9 text-xs shrink-0">
                {numbersBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
              </Button>
            </div>
          </div>

          <Button
            onClick={submit}
            disabled={busy || !advanceValid || advanceTooHigh}
            className="w-full h-11 gap-2 text-sm font-semibold"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {busy ? 'Confirming…' : `Confirm ${orders.length} order${orders.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
