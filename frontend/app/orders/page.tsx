'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import {
  ShoppingBag, Loader2, ChevronRight, FileText, Ticket, IndianRupee,
  Wallet, Inbox, Trophy, ScanLine, Smartphone, Search, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';
import type { OrderListItem, OrderListTotals, CouponHolder, Exhibition } from '@/lib/types';
import { money, ORDER_STATUS_LABELS, ORDER_STATUS_STYLES } from '@/lib/orders';

type Tab = 'all' | 'customer' | 'coupons';

export default function OrdersPage() {
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('all');
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
        // The customer tab is a filter on source, not a separate endpoint.
        source: tab === 'customer' ? 'self_service' : undefined,
        limit: 200,
      });
      setOrders(res.orders);
      setTotals(res.totals);
    } catch {
      toast.error('Could not load orders');
    } finally {
      setLoading(false);
    }
  }, [search, status, exhibitionId, tab]);

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/auth/login'); return; }
    api.getExhibitions().then(setExhibitions).catch(() => {});
  }, [router]);

  useEffect(() => {
    if (tab === 'coupons') return;
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search, tab]);

  useEffect(() => {
    if (tab !== 'coupons') return;
    api.getCouponHolders(exhibitionId ? Number(exhibitionId) : undefined)
      .then(setHolders)
      .catch(() => toast.error('Could not load coupon holders'));
  }, [tab, exhibitionId]);

  const pendingCustomer = totals?.pending_self_service ?? 0;

  const kpis = [
    { label: 'Orders',  value: String(totals?.order_count ?? 0),  icon: ShoppingBag, tone: 'text-blue-600 bg-blue-50' },
    { label: 'Value',   value: money(totals?.total_value ?? 0),   icon: IndianRupee, tone: 'text-violet-600 bg-violet-50' },
    { label: 'Advance', value: money(totals?.total_advance ?? 0), icon: Wallet,      tone: 'text-emerald-600 bg-emerald-50' },
    { label: 'Coupons', value: String(totals?.total_coupons ?? 0), icon: Ticket,     tone: 'text-amber-600 bg-amber-50' },
  ];

  const tabs: { key: Tab; label: string; icon: any; badge?: number }[] = [
    { key: 'all',      label: 'All orders',     icon: Inbox },
    { key: 'customer', label: 'From customers', icon: Smartphone, badge: pendingCustomer },
    { key: 'coupons',  label: 'Lucky draw',     icon: Trophy },
  ];

  return (
    // Capped width: on a wide monitor a full-bleed list leaves the amount
    // stranded a foot away from the order number it belongs to.
    <div className="px-4 md:px-6 py-5 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
          <ShoppingBag className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-slate-900">Orders</h1>
          <p className="text-[11px] text-slate-400">
            {pendingCustomer > 0
              ? `${pendingCustomer} customer order${pendingCustomer === 1 ? '' : 's'} waiting for you`
              : 'Nothing waiting'}
          </p>
        </div>
      </div>

      {/* Customer orders are the work queue — surface them before anything else */}
      {pendingCustomer > 0 && tab !== 'customer' && (
        <button
          onClick={() => setTab('customer')}
          className="w-full flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left hover:border-amber-300 transition-colors"
        >
          <span className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
            <Smartphone className="w-4 h-4 text-amber-700" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-amber-900">
              {pendingCustomer} order{pendingCustomer === 1 ? '' : 's'} placed by customers
            </span>
            <span className="block text-[11px] text-amber-700">
              Scanned their own items — confirm and take the advance
            </span>
          </span>
          <ChevronRight className="w-4 h-4 text-amber-600 shrink-0" />
        </button>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {kpis.map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-3 flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${tone}`}>
              <Icon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-slate-400 leading-none">{label}</p>
              <p className="text-sm font-bold text-slate-900 truncate mt-1">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-full sm:w-fit overflow-x-auto">
        {tabs.map(({ key, label, icon: Icon, badge }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
            {badge ? (
              <span className="min-w-4 h-4 px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center">
                {badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Filters */}
      {tab !== 'coupons' ? (
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1 min-w-0">
            <ScanLine className="w-4 h-4 text-slate-300 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Order no., customer, or barcode"
              className="w-full h-10 pl-9 pr-8 rounded-lg border border-slate-200 bg-white text-sm"
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label="Clear search"
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-300 hover:text-slate-500">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <select value={exhibitionId} onChange={e => setExhibitionId(e.target.value)}
                  className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm sm:w-44">
            <option value="">All exhibitions</option>
            {exhibitions.map(e => (
              <option key={e.exhibition_id} value={e.exhibition_id}>{e.name}</option>
            ))}
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)}
                  className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm sm:w-36">
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      ) : (
        <select value={exhibitionId} onChange={e => setExhibitionId(e.target.value)}
                className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm w-full sm:w-56">
          <option value="">All exhibitions</option>
          {exhibitions.map(e => (
            <option key={e.exhibition_id} value={e.exhibition_id}>{e.name}</option>
          ))}
        </select>
      )}

      {loading && tab !== 'coupons' ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-300" /></div>
      ) : tab === 'coupons' ? (
        <CouponTable holders={holders} onOpen={id => router.push(`/leads/${id}`)} />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={tab === 'customer' ? Smartphone : ShoppingBag}
          title={tab === 'customer' ? 'No customer orders yet' : search ? 'Nothing matches' : 'No orders yet'}
          hint={tab === 'customer'
            ? 'Orders placed from the QR page land here for confirmation.'
            : search ? `Nothing for “${search}” — including item barcodes.` : 'Place one from a lead.'}
        />
      ) : (
        <div className="space-y-2">
          {search && (
            <p className="text-[11px] text-slate-400">
              {orders.length} match{orders.length === 1 ? '' : 'es'}, including orders whose items carry that barcode
            </p>
          )}
          {orders.map(o => <OrderRow key={o.order_id} order={o}
                                     onOpen={() => router.push(`/orders/${o.order_id}`)} />)}
        </div>
      )}
    </div>
  );
}

function OrderRow({ order: o, onOpen }: { order: OrderListItem; onOpen: () => void }) {
  const fromCustomer = o.source === 'self_service';
  const needsAction = o.status_code === 'draft';

  return (
    <motion.button
      whileHover={{ y: -1 }}
      onClick={onOpen}
      className="w-full text-left rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-colors flex overflow-hidden"
    >
      {/* Status accent — a draft needs work, and should read that way at a glance */}
      <span className={`w-1 shrink-0 ${
        o.status_code === 'confirmed' ? 'bg-emerald-400'
        : o.status_code === 'cancelled' ? 'bg-slate-200'
        : fromCustomer ? 'bg-amber-400' : 'bg-blue-300'
      }`} />

      <div className="flex-1 min-w-0 flex items-center gap-3 p-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-slate-900">{o.order_number}</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${ORDER_STATUS_STYLES[o.status_code]}`}>
              {ORDER_STATUS_LABELS[o.status_code]}
            </span>
            {fromCustomer && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 inline-flex items-center gap-0.5">
                <Smartphone className="w-2.5 h-2.5" /> From customer
              </span>
            )}
            {o.so_pdf_path && <FileText className="w-3 h-3 text-slate-300" />}
          </div>

          <p className="text-xs text-slate-600 truncate mt-0.5">
            {o.lead_name || 'Unknown'}
            {o.lead_company_name ? <span className="text-slate-400"> · {o.lead_company_name}</span> : null}
          </p>
          <p className="text-[10px] text-slate-400 truncate">
            {o.item_count} item{o.item_count === 1 ? '' : 's'} · {o.total_pieces} pc
            {o.exhibition_name ? ` · ${o.exhibition_name}` : ''}
            {' · '}
            <span suppressHydrationWarning>
              {formatDistanceToNow(new Date(o.created_at), { addSuffix: true })}
            </span>
          </p>
        </div>

        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-slate-900">{money(o.effective_value)}</p>
          <p className={`text-[10px] ${needsAction && o.advance_amount === 0 ? 'text-amber-600 font-semibold' : 'text-slate-400'}`}>
            {o.advance_amount > 0 ? `adv ${money(o.advance_amount)}` : 'no advance yet'}
          </p>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
      </div>
    </motion.button>
  );
}

function EmptyState({ icon: Icon, title, hint }: { icon: any; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 py-16 text-center">
      <Icon className="w-10 h-10 text-slate-200" />
      <p className="text-sm font-medium text-slate-500">{title}</p>
      <p className="text-[11px] text-slate-400 max-w-xs">{hint}</p>
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
      <EmptyState icon={Ticket} title="No coupons issued yet"
                  hint="Coupons are earned on advance received — ₹11,000 per 4 coupons." />
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
          <span className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold ${
            i === 0 ? 'bg-amber-100 text-amber-700' : 'text-slate-400'
          }`}>
            {i + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">{h.lead_name || 'Unknown'}</p>
            <p className="text-[11px] text-slate-400 truncate">
              {h.company_name || h.phone || `${h.order_count} order${h.order_count === 1 ? '' : 's'}`}
            </p>
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
