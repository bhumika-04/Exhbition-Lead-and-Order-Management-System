'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  ShoppingBag, Search, Loader2, ChevronRight, FileText, Ticket,
  IndianRupee, Wallet, Inbox, Trophy, ScanLine,
} from 'lucide-react';
import { api } from '@/lib/api';
import { isAuthenticated, hasPermission } from '@/lib/auth';
import type { OrderListItem, OrderListTotals, CouponHolder, Exhibition } from '@/lib/types';
import { money, ORDER_STATUS_LABELS, ORDER_STATUS_STYLES } from '@/lib/orders';
import { Card, CardContent } from '@/components/ui/card';

type Tab = 'orders' | 'coupons';

export default function OrdersPage() {
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('orders');
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [totals, setTotals] = useState<OrderListTotals | null>(null);
  const [holders, setHolders] = useState<CouponHolder[]>([]);
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [exhibitionId, setExhibitionId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.searchOrders({
        search: search || undefined,
        status_code: status || undefined,
        exhibition_id: exhibitionId ? Number(exhibitionId) : undefined,
        limit: 200,
      });
      setOrders(res.orders);
      setTotals(res.totals);
    } catch {
      toast.error('Could not load orders');
    } finally {
      setLoading(false);
    }
  }, [search, status, exhibitionId]);

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/auth/login'); return; }
    api.getExhibitions().then(setExhibitions).catch(() => {});
  }, [router]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);   // debounce typing
    return () => clearTimeout(t);
  }, [load, search]);

  useEffect(() => {
    if (tab !== 'coupons') return;
    api.getCouponHolders(exhibitionId ? Number(exhibitionId) : undefined)
      .then(setHolders)
      .catch(() => toast.error('Could not load coupon holders'));
  }, [tab, exhibitionId]);

  // Self-service orders need working, not just viewing — surface them first.
  const pending = orders.filter(o => o.status_code === 'draft');

  const kpis = [
    { label: 'Orders',  value: String(totals?.order_count ?? 0),        icon: ShoppingBag, tone: 'text-blue-600 bg-blue-100' },
    { label: 'Value',   value: money(totals?.total_value ?? 0),         icon: IndianRupee, tone: 'text-violet-600 bg-violet-100' },
    { label: 'Advance', value: money(totals?.total_advance ?? 0),       icon: Wallet,      tone: 'text-emerald-600 bg-emerald-100' },
    { label: 'Coupons', value: String(totals?.total_coupons ?? 0),      icon: Ticket,      tone: 'text-amber-600 bg-amber-100' },
  ];

  return (
    <div className="px-4 md:px-6 py-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
          <ShoppingBag className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-slate-900">Orders</h1>
          <p className="text-[11px] text-slate-400">
            {pending.length > 0
              ? `${pending.length} awaiting confirmation`
              : 'All orders confirmed'}
          </p>
        </div>
      </div>

      {/* KPIs — computed over the whole filter, not just the visible page */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map(({ label, value, icon: Icon, tone }) => (
          <Card key={label} className="border-slate-200">
            <CardContent className="p-3 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tone}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
                <p className="text-sm font-bold text-slate-900 truncate">{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {([['orders', 'All orders', Inbox], ['coupons', 'Lucky draw', Trophy]] as const).map(
          ([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <ScanLine className="w-4 h-4 text-slate-300 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Order no., customer, or scan a barcode"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 bg-white text-sm"
          />
        </div>
        <select value={exhibitionId} onChange={e => setExhibitionId(e.target.value)}
                className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm">
          <option value="">All exhibitions</option>
          {exhibitions.map(e => (
            <option key={e.exhibition_id} value={e.exhibition_id}>{e.name}</option>
          ))}
        </select>
        {tab === 'orders' && (
          <select value={status} onChange={e => setStatus(e.target.value)}
                  className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm">
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        )}
      </div>

      {/* Barcode search is the reason this box exists — the ERP holds the
          catalogue and the cross-check is manual. */}
      {search && tab === 'orders' && !loading && (
        <p className="text-[11px] text-slate-400">
          {orders.length} order{orders.length === 1 ? '' : 's'} matching “{search}” — including any whose items carry that barcode.
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-300" /></div>
      ) : tab === 'coupons' ? (
        <CouponTable holders={holders} onOpen={id => router.push(`/leads/${id}`)} />
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <ShoppingBag className="w-10 h-10 text-slate-200" />
          <p className="text-sm text-slate-400">No orders found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map(o => (
            <motion.button
              key={o.order_id}
              whileHover={{ y: -1 }}
              onClick={() => router.push(`/orders/${o.order_id}`)}
              className="w-full text-left rounded-xl border border-slate-200 bg-white p-3 flex items-center gap-3 hover:border-slate-300 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-semibold text-slate-900">{o.order_number}</span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${ORDER_STATUS_STYLES[o.status_code]}`}>
                    {ORDER_STATUS_LABELS[o.status_code]}
                  </span>
                  {o.so_pdf_path && <FileText className="w-3 h-3 text-slate-300" />}
                </div>
                <p className="text-xs text-slate-500 truncate mt-0.5">
                  {o.lead_name || 'Unknown'}
                  {o.lead_company_name ? ` · ${o.lead_company_name}` : ''}
                </p>
                <p className="text-[10px] text-slate-400">
                  {o.item_count} item{o.item_count === 1 ? '' : 's'} · {o.total_pieces} pc
                  {o.exhibition_name ? ` · ${o.exhibition_name}` : ''}
                </p>
              </div>

              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-slate-900">{money(o.effective_value)}</p>
                <p className="text-[10px] text-slate-400">adv {money(o.advance_amount)}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
            </motion.button>
          ))}
        </div>
      )}
      <div className="md:hidden h-20" />
    </div>
  );
}

/**
 * Lucky-draw view. Coupons are a lead-level figure derived from total advance,
 * so this ranks people, not orders.
 */
function CouponTable({ holders, onOpen }: { holders: CouponHolder[]; onOpen: (leadId: number) => void }) {
  const total = holders.reduce((s, h) => s + h.coupons, 0);
  const max = holders.length > 0 ? holders[0].coupons : 0;

  if (holders.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <Ticket className="w-10 h-10 text-slate-200" />
        <p className="text-sm text-slate-400">No coupons issued yet</p>
        <p className="text-[11px] text-slate-400 max-w-xs">
          Coupons are earned on advance received — ₹11,000 per 4 coupons.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-400">
        {total} entr{total === 1 ? 'y' : 'ies'} across {holders.length} customer{holders.length === 1 ? '' : 's'}
      </p>
      {holders.map((h, i) => (
        <button
          key={h.lead_id}
          onClick={() => onOpen(h.lead_id)}
          className="w-full text-left rounded-xl border border-slate-200 bg-white p-3 flex items-center gap-3 hover:border-slate-300 transition-colors"
        >
          <span className="w-6 text-xs font-bold text-slate-400 shrink-0 text-center">{i + 1}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">{h.lead_name || 'Unknown'}</p>
            <p className="text-[11px] text-slate-400 truncate">
              {h.company_name || h.phone || `${h.order_count} order${h.order_count === 1 ? '' : 's'}`}
            </p>
            {/* Relative bar makes the ranking readable at a glance on draw day */}
            <div className="h-1 bg-slate-100 rounded-full mt-1.5 overflow-hidden">
              <div className="h-full bg-amber-400 rounded-full"
                   style={{ width: `${max > 0 ? (h.coupons / max) * 100 : 0}%` }} />
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-bold text-amber-700">{h.coupons}</p>
            <p className="text-[10px] text-slate-400">adv {money(h.total_advance)}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
