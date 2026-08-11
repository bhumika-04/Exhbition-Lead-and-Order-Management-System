'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingBag, Plus, Ticket, ChevronRight, Loader2, FileText, FileClock } from 'lucide-react';
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
export default function LeadOrdersCard({ leadId, show = 'placed' }: {
  leadId: number;
  /**
   * 'placed'  — confirmed and cancelled orders, plus the lead's money position.
   * 'drafts'  — only unfinished orders, rendered as its own card.
   *
   * Split because they answer different questions. "What has this customer
   * bought" and "what is still sitting unfinished" belong in different places
   * on the page, and mixing them made a draft look like a sale in the totals.
   */
  show?: 'placed' | 'drafts';
}) {
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
        setOrders(res.orders.filter(o =>
          show === 'drafts' ? o.status_code === 'draft' : o.status_code !== 'draft'));
        setSummary(res.summary);
      } catch {
        // A lead with no orders is the normal case; stay quiet rather than
        // showing an error toast on every lead detail view.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leadId, show]);

  return (
    <Card className="shadow-sm border-border">
      <CardContent className="px-5 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {show === 'drafts'
              ? <FileClock className="w-4 h-4 text-warning" />
              : <ShoppingBag className="w-4 h-4 text-muted-foreground" />}
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {show === 'drafts' ? 'Unfinished' : 'Orders'}
              {orders.length > 0 ? ` (${orders.length})` : ''}
            </span>
          </div>
          {show === 'placed' && summary && summary.coupons > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-warning/15 text-warning px-2 py-0.5 rounded-full">
              <Ticket className="w-3 h-3" /> {summary.coupons}
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-3">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/50" />
          </div>
        ) : orders.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {show === 'drafts' ? 'Nothing unfinished.' : 'No orders yet.'}
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              {orders.map(o => (
                <button
                  key={o.order_id}
                  onClick={() => router.push(`/orders/${o.order_id}`)}
                  className="w-full flex items-center gap-2 px-3 py-2 lg:py-2.5 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs lg:text-sm font-semibold text-foreground truncate">{o.order_number}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${ORDER_STATUS_STYLES[o.status_code]}`}>
                        {ORDER_STATUS_LABELS[o.status_code]}
                      </span>
                      {o.so_pdf_path && <FileText className="w-3 h-3 text-muted-foreground/50 shrink-0" />}
                    </div>
                    <span className="text-[10px] lg:text-[11px] text-muted-foreground">
                      {o.item_count} item{o.item_count === 1 ? '' : 's'} · {o.total_pieces} pc
                    </span>
                  </div>
                  <span className="text-xs lg:text-sm font-bold text-foreground shrink-0">{money(o.order_total)}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                </button>
              ))}
            </div>

            {show === 'placed' && summary && (
              <div className="pt-2 border-t border-border space-y-1.5">
                <Line label="Total value" value={money(summary.lead_total)} bold />
                <Line label="Advance received" value={money(summary.total_advance)} />
                <Line label="Balance due" value={money(summary.balance)} />
              </div>
            )}
          </>
        )}

        {show === 'placed' && canManage && (
          <Button
            variant="outline"
            onClick={() => router.push(`/leads/${leadId}/orders/new`)}
            className="w-full h-9 lg:h-10 gap-1.5 text-xs border-dashed"
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
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={bold ? 'text-sm font-bold text-foreground' : 'text-xs text-foreground'}>{value}</span>
    </div>
  );
}
