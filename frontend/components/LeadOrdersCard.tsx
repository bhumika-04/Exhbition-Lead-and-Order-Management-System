'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingBag, Plus, Ticket, ChevronRight, Loader2, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { hasPermission } from '@/lib/auth';
import type { OrderSummary, LeadOrderSummary } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { money, ORDER_STATUS_LABELS, ORDER_STATUS_STYLES } from '@/lib/orders';

/**
 * Orders placed by a lead, plus their advance/coupon position.
 * Both are lead-level: advance and coupons come from the combined value of
 * every non-cancelled order, so they are shown here rather than per order.
 */
export default function LeadOrdersCard({ leadId }: { leadId: number }) {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [summary, setSummary] = useState<LeadOrderSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const canManage = hasPermission('manage_orders');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getOrdersForLead(leadId);
        if (cancelled) return;
        setOrders(res.orders);
        setSummary(res.summary);
      } catch {
        // A lead with no orders is the normal case; stay quiet rather than
        // showing an error toast on every lead detail view.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leadId]);

  return (
    <Card className="shadow-sm border-slate-100">
      <CardContent className="px-5 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Orders{orders.length > 0 ? ` (${orders.length})` : ''}
            </span>
          </div>
          {summary && summary.coupons > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
              <Ticket className="w-3 h-3" /> {summary.coupons}
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-3">
            <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
          </div>
        ) : orders.length === 0 ? (
          <p className="text-xs text-slate-400">No orders yet.</p>
        ) : (
          <>
            <div className="space-y-1.5">
              {orders.map(o => (
                <button
                  key={o.order_id}
                  onClick={() => router.push(`/orders/${o.order_id}`)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-slate-800 truncate">{o.order_number}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${ORDER_STATUS_STYLES[o.status_code]}`}>
                        {ORDER_STATUS_LABELS[o.status_code]}
                      </span>
                      {o.so_pdf_path && <FileText className="w-3 h-3 text-slate-300 shrink-0" />}
                    </div>
                    <span className="text-[10px] text-slate-400">
                      {o.item_count} item{o.item_count === 1 ? '' : 's'} · {o.total_pieces} pc
                    </span>
                  </div>
                  <span className="text-xs font-bold text-slate-800 shrink-0">{money(o.order_total)}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                </button>
              ))}
            </div>

            {summary && (
              <div className="pt-2 border-t border-slate-100 space-y-1.5">
                <Line label="Total value" value={money(summary.lead_total)} bold />
                <Line label="Advance received" value={money(summary.total_advance)} />
                <Line label="Balance due" value={money(summary.balance)} />
              </div>
            )}
          </>
        )}

        {canManage && (
          <Button
            variant="outline"
            onClick={() => router.push(`/leads/${leadId}/orders/new`)}
            className="w-full h-9 gap-1.5 text-xs border-dashed"
          >
            <Plus className="w-3.5 h-3.5" /> Place Order
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className={bold ? 'text-sm font-bold text-slate-900' : 'text-xs text-slate-700'}>{value}</span>
    </div>
  );
}
