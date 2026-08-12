'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ShoppingBag, Plus, Ticket, ChevronRight, Loader2, FileText, FileClock,
  CheckSquare, Square, Send,
} from 'lucide-react';
import { api } from '@/lib/api';
import { hasPermission } from '@/lib/auth';
import type { OrderSummary, LeadOrderSummary } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { money, ORDER_STATUS_LABELS, ORDER_STATUS_STYLES } from '@/lib/orders';
import BulkPaymentModal from '@/components/BulkPaymentModal';

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

  // Bulk payment — several of this lead's orders, paid for in one go, because
  // they are one customer settling up once, not several. Works in both views:
  // a draft picked up here is confirmed as part of taking its share, an
  // already-placed order just has its advance updated.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showBulk, setShowBulk] = useState(false);

  const canManage = hasPermission('manage_orders');

  const load = useCallback(async () => {
    try {
      const res = await api.getOrdersForLead(leadId);
      setOrders(res.orders.filter(o =>
        show === 'drafts' ? o.status_code === 'draft' : o.status_code !== 'draft'));
      setSummary(res.summary);
    } catch {
      // A lead with no orders is the normal case; stay quiet rather than
      // showing an error toast on every lead detail view.
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, show]);

  useEffect(() => { load(); }, [load]);

  const toggleSelect = (orderId: number) => {
    setSelected(s => {
      const next = new Set(s);
      if (next.has(orderId)) next.delete(orderId); else next.add(orderId);
      return next;
    });
  };

  const selectedOrders = orders.filter(o => selected.has(o.order_id));
  const selectedValue = selectedOrders.reduce((sum, o) => sum + o.effective_value, 0);

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
                <div key={o.order_id} className="flex items-center gap-1.5">
                  {/* Selecting more than one draft only makes sense when there
                      is more than one — a single draft is confirmed the plain
                      way, from its own page. The Sales Order and its payment
                      are a one-time step at confirmation, not something
                      bulk-editable on an already-placed order afterwards. */}
                  {show === 'drafts' && canManage && orders.length > 1 && (
                    <button
                      type="button"
                      onClick={() => toggleSelect(o.order_id)}
                      aria-label={selected.has(o.order_id) ? 'Deselect' : 'Select'}
                      className="p-1 text-muted-foreground hover:text-primary shrink-0"
                    >
                      {selected.has(o.order_id)
                        ? <CheckSquare className="w-4 h-4 text-primary" />
                        : <Square className="w-4 h-4" />}
                    </button>
                  )}
                  <button
                    onClick={() => router.push(`/orders/${o.order_id}`)}
                    className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 lg:py-2.5 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors text-left"
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
                </div>
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

        {show === 'drafts' && selected.size > 0 && (
          <Button
            onClick={() => setShowBulk(true)}
            className="w-full h-10 gap-1.5 text-xs"
          >
            <Send className="w-3.5 h-3.5" />
            Set payment &amp; confirm {selected.size} order{selected.size === 1 ? '' : 's'} · {money(selectedValue)}
          </Button>
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

      {showBulk && (
        <BulkPaymentModal
          leadId={leadId}
          orders={selectedOrders}
          onClose={() => setShowBulk(false)}
          onDone={() => { setSelected(new Set()); setShowBulk(false); load(); }}
        />
      )}
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
