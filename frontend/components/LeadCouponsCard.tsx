'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Ticket, Loader2, Shield, X, Plus, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { hasPermission } from '@/lib/auth';
import { money, slabForValue } from '@/lib/orders';
import type { SlabOption } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Lucky-draw coupons for one lead: the earned-or-overridden count, an
 * admin-only control to override it, and the physical coupon numbers handed
 * out. Self-contained like LeadMediaCard — fetches its own data rather than
 * threading it through the parent page's two (mobile/desktop) layouts.
 */
export default function LeadCouponsCard({ leadId }: { leadId: number }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [coupons, setCoupons] = useState(0);
  const [overrideSlab, setOverrideSlab] = useState<number | null>(null);
  const [numbers, setNumbers] = useState<string[]>([]);
  const [slabs, setSlabs] = useState<SlabOption[]>([]);

  const [numbersInput, setNumbersInput] = useState('');
  const [showOverride, setShowOverride] = useState(false);
  const [showNumbers, setShowNumbers] = useState(false);

  const isAdmin = hasPermission('manage_roles');
  const canRecordNumbers = hasPermission('manage_orders');

  const load = useCallback(async () => {
    try {
      const [lead, summary, slabOptions] = await Promise.all([
        api.getLead(leadId),
        api.getLeadOrderSummary(leadId),
        // Fetched generously, then trimmed below to what's actually relevant —
        // the count depends on this lead's order total, known only once the
        // summary above resolves.
        api.getOrderSlabs(10).catch(() => []),
      ]);
      setCoupons(summary.coupons);
      setOverrideSlab(lead.coupon_override_slab ?? null);

      // Only the slab this lead's order total actually falls into, or an
      // existing override if that reaches further — not a buffer above it.
      const relevantSlab = Math.max(
        1,
        slabForValue(summary.lead_total),
        lead.coupon_override_slab ?? 0,
      );
      setSlabs(slabOptions.slice(0, relevantSlab));
      try {
        setNumbers(lead.coupon_numbers ? JSON.parse(lead.coupon_numbers) : []);
      } catch { setNumbers([]); }
    } catch {
      // No summary yet (a brand-new lead) is normal — stay quiet.
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const saveOverride = async (slab: number | null) => {
    if (slab != null && (!Number.isFinite(slab) || slab < 0)) {
      toast.error('Enter a slab of 0 or more'); return;
    }
    setBusy(true);
    try {
      const res = await api.setLeadCouponOverride(leadId, slab);
      toast.success(slab == null ? 'Override cleared — coupons follow advance again' : `Override set — ${res.coupons} coupons`);
      setShowOverride(false);
      // Re-read rather than trust this response for display: clearing does not
      // report a coupon count (see api.setLeadCouponOverride), and the summary
      // endpoint is the single source of truth for what the lead actually has.
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not set the override');
    } finally { setBusy(false); }
  };

  const saveNumbers = async () => {
    const entered = numbersInput.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    const combined = Array.from(new Set([...numbers, ...entered]));
    if (combined.length === numbers.length && entered.length === 0) {
      setShowNumbers(false); return;
    }
    // Can't record more physical coupons than the slab actually earned —
    // typing past it would hand out lucky-draw entries nothing backs.
    if (combined.length > coupons) {
      toast.error(`This lead has earned ${coupons} coupon${coupons === 1 ? '' : 's'} — that's ${combined.length - coupons} too many.`);
      return;
    }
    setBusy(true);
    try {
      const saved = await api.setLeadCouponNumbers(leadId, combined);
      setNumbers(saved);
      setNumbersInput('');
      toast.success('Coupon numbers saved');
      setShowNumbers(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not save the coupon numbers');
    } finally { setBusy(false); }
  };

  const removeNumber = async (n: string) => {
    setBusy(true);
    try {
      const saved = await api.setLeadCouponNumbers(leadId, numbers.filter(x => x !== n));
      setNumbers(saved);
    } catch {
      toast.error('Could not remove that number');
    } finally { setBusy(false); }
  };

  if (loading) {
    return (
      <Card className="shadow-sm border-border">
        <CardContent className="px-5 py-6 flex justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/50" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm border-border">
      <CardContent className="px-5 py-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 bg-primary/12 rounded-lg flex items-center justify-center shrink-0">
            <Ticket className="w-4 h-4 text-primary" />
          </span>
          <p className="text-sm font-semibold text-foreground flex-1">Coupons</p>
          <span className="text-lg font-bold text-primary tabular">{coupons}</span>
        </div>

        {overrideSlab != null && (
          <div className="flex items-center gap-1.5 text-[11px] text-warning bg-warning/[0.08] border border-warning/25 rounded-lg px-2.5 py-1.5">
            <Shield className="w-3 h-3 shrink-0" />
            Overridden to slab {overrideSlab} — not based on advance taken
          </div>
        )}

        {isAdmin && (
          showOverride ? (
            <div className="space-y-1 rounded-lg border border-border p-1.5">
              {slabs.map(opt => (
                <SlabRow
                  key={opt.slab}
                  active={overrideSlab === opt.slab}
                  disabled={busy}
                  title={`${money(opt.from_value)}–${money(opt.to_value)}`}
                  detail={`${opt.coupons_if_paid} coupons`}
                  onClick={() => saveOverride(opt.slab)}
                />
              ))}

              {overrideSlab != null && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => saveOverride(null)}
                        className="h-8 text-xs w-full mt-1">
                  Clear override — coupons follow advance again
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setShowOverride(false)} className="h-7 text-xs w-full">
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setShowOverride(true)} className="h-8 gap-1.5 text-xs w-full">
              <Shield className="w-3.5 h-3.5" />
              {overrideSlab != null ? 'Change override' : 'Grant coupons without advance'}
            </Button>
          )
        )}

        {numbers.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {numbers.map(n => (
              <span key={n} className="inline-flex items-center gap-1 bg-secondary text-foreground rounded-lg pl-2.5 pr-1 py-1 text-[11px]">
                {n}
                {canRecordNumbers && (
                  <button onClick={() => removeNumber(n)} disabled={busy} aria-label={`Remove ${n}`}
                          className="p-0.5 rounded hover:bg-card">
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {canRecordNumbers && (
          showNumbers ? (
            <div className="space-y-1.5">
              <textarea
                value={numbersInput} onChange={e => setNumbersInput(e.target.value)}
                placeholder="A-102, A-103 or one per line"
                rows={2}
                className="w-full px-2.5 py-2 rounded-md border border-border text-xs resize-none"
              />
              <div className="flex gap-1.5">
                <Button size="sm" disabled={busy} onClick={saveNumbers} className="h-8 text-xs flex-1">
                  {busy && <Loader2 className="w-3 h-3 animate-spin mr-1" />} Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowNumbers(false)} className="h-8 text-xs">
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setShowNumbers(true)} className="h-8 gap-1.5 text-xs w-full">
              <Plus className="w-3.5 h-3.5" /> Record coupon numbers
            </Button>
          )
        )}
      </CardContent>
    </Card>
  );
}

/** One preset — same "value range → coupon count" shape as the order page's slab picker. */
function SlabRow({ active, disabled, title, detail, onClick }: {
  active: boolean; disabled: boolean; title: string; detail: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors disabled:opacity-50 ${
        active ? 'bg-primary/[0.08]' : 'hover:bg-secondary/60'
      }`}
    >
      <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
        active ? 'border-primary bg-primary' : 'border-input'
      }`}>
        {active && <Check className="w-2 h-2 text-primary-foreground" />}
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block text-xs ${active ? 'font-semibold text-primary' : 'text-foreground'}`}>{title}</span>
      </span>
      <span className="text-[10px] text-muted-foreground shrink-0">{detail}</span>
    </button>
  );
}
