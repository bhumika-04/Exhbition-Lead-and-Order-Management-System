'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import {
  ShoppingBag, Loader2, ChevronRight, FileText, Ticket, IndianRupee,
  Wallet, Inbox, Trophy, ScanLine, Smartphone, Search, X,
  FileClock, CheckCircle2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';
import type { OrderListItem, OrderListTotals, CouponHolder, Exhibition } from '@/lib/types';
import { money, ORDER_STATUS_LABELS, ORDER_STATUS_STYLES } from '@/lib/orders';
import PageHeader from '@/components/PageHeader';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Shared control styling, so the search box and both selects stay in step. */
const inputClass =
  'h-9 w-full rounded-lg border border-border bg-card text-sm text-foreground ' +
  'placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-input';

type Tab = 'all' | 'customer' | 'drafts' | 'confirmed' | 'coupons';

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
        // Drafts and Confirmed are the status filter under another name, so
        // the tab wins over the dropdown rather than the two contradicting
        // each other and returning nothing.
        status_code: tab === 'drafts' ? 'draft'
          : tab === 'confirmed' ? 'confirmed'
          : status || undefined,
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

  const value   = totals?.total_value ?? 0;
  const advance = totals?.total_advance ?? 0;

  const kpis = [
    { label: 'Orders',  value: String(totals?.order_count ?? 0), icon: ShoppingBag,
      tone: 'primary' as const },
    { label: 'Value',   value: money(value), icon: IndianRupee },
    { label: 'Advance', value: money(advance), icon: Wallet, tone: 'success' as const,
      hint: value > 0 ? `${Math.round((advance / value) * 100)}% collected` : undefined },
    { label: 'Coupons', value: String(totals?.total_coupons ?? 0), icon: Ticket },
  ];

  const tabs: { key: Tab; label: string; icon: any; badge?: number }[] = [
    { key: 'all',       label: 'All orders',     icon: Inbox },
    { key: 'customer',  label: 'From customers', icon: Smartphone, badge: pendingCustomer },
    { key: 'drafts',    label: 'Drafts',         icon: FileClock },
    { key: 'confirmed', label: 'Confirmed',      icon: CheckCircle2 },
    { key: 'coupons',   label: 'Lucky draw',     icon: Trophy },
  ];

  return (
    <>
      <PageHeader
        icon={ShoppingBag}
        title="Orders"
        subtitle={pendingCustomer > 0
          ? `${pendingCustomer} customer order${pendingCustomer === 1 ? '' : 's'} waiting for you`
          : 'Nothing waiting'}
      />

      {/* Still capped — full-bleed leaves the amount stranded a foot from the
          order number it belongs to — but 5xl was so narrow on a 1080p monitor
          that the page read as mostly margin. */}
      <div className="px-4 md:px-6 py-4 max-w-7xl mx-auto space-y-3">

      {/* Customer orders are the work queue — surface them before anything else */}
      {pendingCustomer > 0 && tab !== 'customer' && (
        <button
          onClick={() => setTab('customer')}
          className="group w-full flex items-center gap-3 rounded-lg border border-warning/25
                     bg-warning/[0.07] px-3.5 py-2.5 text-left
                     hover:border-warning/40 hover:bg-warning/10 transition-colors"
        >
          <span className="rounded-md bg-warning/15 p-1.5 shrink-0">
            <Smartphone className="w-3.5 h-3.5 text-warning" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-foreground">
              {pendingCustomer} order{pendingCustomer === 1 ? '' : 's'} placed by customers
            </span>
            <span className="block text-[11px] text-muted-foreground">
              Scanned their own items — confirm and take the advance
            </span>
          </span>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
        </button>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 auto-rows-fr">
        {kpis.map(k => (
          <StatCard key={k.label} label={k.label} value={k.value} icon={k.icon}
                    tone={k.tone} hint={k.hint} />
        ))}
      </div>

      {/* Tabs and filters share a row from lg up — separately they cost two
          full-width bands above a list that is often only a few rows tall. */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-2">
        <div className="flex gap-0.5 bg-secondary rounded-lg p-0.5 w-full lg:w-fit shrink-0 overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon, badge }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'px-3 h-8 rounded-md text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-all',
                tab === key
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
              {badge ? (
                <span className="min-w-[16px] h-4 px-1 rounded-full bg-warning/15 text-warning
                                 text-[9px] font-bold flex items-center justify-center tabular">
                  {badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Search takes its own line on a phone (it needs the width); the two
            selects share the row beneath it. */}
        {tab !== 'coupons' ? (
          <div className="flex flex-col sm:flex-row gap-2 flex-1 min-w-0">
            <div className="relative w-full sm:flex-1 min-w-0">
              <ScanLine className="w-4 h-4 text-muted-foreground/50 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Order no., customer, or barcode"
                className={inputClass + ' pl-9 pr-8'}
              />
              {search && (
                <button onClick={() => setSearch('')} aria-label="Clear search"
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground/50 hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex flex-row gap-2 shrink-0">
              <select value={exhibitionId} onChange={e => setExhibitionId(e.target.value)}
                      className={inputClass + ' px-2.5 flex-1 min-w-0 sm:flex-none sm:w-40'}>
                <option value="">All exhibitions</option>
                {exhibitions.map(e => (
                  <option key={e.exhibition_id} value={e.exhibition_id}>{e.name}</option>
                ))}
              </select>
              {/* Hidden on the Drafts and Confirmed tabs: the tab already fixes
                  the status, and leaving the dropdown visible would let it show
                  "Cancelled" while the list ignored it. */}
              {tab !== 'drafts' && tab !== 'confirmed' && (
                <select value={status} onChange={e => setStatus(e.target.value)}
                        className={inputClass + ' px-2.5 flex-1 min-w-0 sm:flex-none sm:w-36'}>
                  <option value="">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              )}
            </div>
          </div>
        ) : (
          <select value={exhibitionId} onChange={e => setExhibitionId(e.target.value)}
                  className={inputClass + ' px-2.5 w-full lg:w-56'}>
            <option value="">All exhibitions</option>
            {exhibitions.map(e => (
              <option key={e.exhibition_id} value={e.exhibition_id}>{e.name}</option>
            ))}
          </select>
        )}
      </div>

      {loading && tab !== 'coupons' ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground/40" /></div>
      ) : tab === 'coupons' ? (
        <CouponTable holders={holders} onOpen={id => router.push(`/leads/${id}`)} />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={tab === 'customer' ? Smartphone
            : tab === 'drafts' ? FileClock
            : tab === 'confirmed' ? CheckCircle2 : ShoppingBag}
          title={
            search ? 'Nothing matches'
              : tab === 'customer'  ? 'No customer orders yet'
              : tab === 'drafts'    ? 'Nothing unfinished'
              : tab === 'confirmed' ? 'Nothing confirmed yet'
              : 'No orders yet'
          }
          hint={
            search ? `Nothing for “${search}” — including item barcodes.`
              : tab === 'customer'  ? 'Orders placed from the QR page land here for confirmation.'
              : tab === 'drafts'    ? 'Every order has been confirmed or cancelled.'
              : tab === 'confirmed' ? 'Confirm a draft to issue its Sales Order.'
              : 'Place one from a lead.'
          }
        />
      ) : (
        <div className="space-y-2">
          {search && (
            <p className="text-[11px] text-muted-foreground">
              {orders.length} match{orders.length === 1 ? '' : 'es'}, including orders whose items carry that barcode
            </p>
          )}
          {orders.map(o => <OrderRow key={o.order_id} order={o}
                                     onOpen={() => router.push(`/orders/${o.order_id}`)} />)}
        </div>
      )}
      </div>
    </>
  );
}

function OrderRow({ order: o, onOpen }: { order: OrderListItem; onOpen: () => void }) {
  const fromCustomer = o.source === 'self_service';
  const needsAction = o.status_code === 'draft';

  return (
    <button
      onClick={onOpen}
      className="group w-full text-left rounded-lg border border-border bg-card overflow-hidden
                 flex shadow-xs transition-[border-color,box-shadow,transform] duration-150
                 hover:border-input hover:shadow-sm hover:-translate-y-px
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      {/* Status accent — a draft needs work, and should read that way at a glance */}
      <span className={cn('w-[3px] shrink-0',
        o.status_code === 'confirmed' ? 'bg-success'
        : o.status_code === 'cancelled' ? 'bg-border'
        : fromCustomer ? 'bg-warning' : 'bg-primary/50',
      )} />

      <div className="flex-1 min-w-0 flex items-center gap-3 px-3.5 py-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-foreground tabular tracking-tight">
              {o.order_number}
            </span>
            <Badge variant={
              o.status_code === 'confirmed' ? 'success'
              : o.status_code === 'cancelled' ? 'default' : 'primary'
            }>
              {ORDER_STATUS_LABELS[o.status_code]}
            </Badge>
            {fromCustomer && (
              <Badge variant="warning">
                <Smartphone className="w-2.5 h-2.5" /> Customer
              </Badge>
            )}
            {o.so_pdf_path && <FileText className="w-3 h-3 text-muted-foreground/50" />}
          </div>

          <p className="text-xs text-foreground/80 truncate mt-1">
            {o.lead_name || 'Unknown'}
            {o.lead_company_name
              ? <span className="text-muted-foreground"> · {o.lead_company_name}</span> : null}
          </p>
          <p className="text-[10px] text-muted-foreground truncate mt-0.5">
            {o.item_count} item{o.item_count === 1 ? '' : 's'} · {o.total_pieces} pc
            {o.exhibition_name ? ` · ${o.exhibition_name}` : ''}
            {' · '}
            <span suppressHydrationWarning>
              {formatDistanceToNow(new Date(o.created_at), { addSuffix: true })}
            </span>
          </p>
        </div>

        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-foreground tabular">{money(o.effective_value)}</p>
          <p className={cn('text-[10px] tabular mt-0.5',
            needsAction && o.advance_amount === 0
              ? 'text-warning font-medium' : 'text-muted-foreground',
          )}>
            {o.advance_amount > 0 ? `adv ${money(o.advance_amount)}` : 'no advance yet'}
          </p>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0
                                 transition-transform group-hover:translate-x-0.5" />
      </div>
    </button>
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
      <p className="text-[11px] text-muted-foreground">
        {total} entr{total === 1 ? 'y' : 'ies'} across {holders.length} customer{holders.length === 1 ? '' : 's'}
      </p>
      {holders.map((h, i) => (
        <button
          key={h.lead_id}
          onClick={() => onOpen(h.lead_id)}
          className="group w-full text-left rounded-lg border border-border bg-card shadow-xs
                     px-3.5 py-2.5 flex items-center gap-3
                     transition-[border-color,box-shadow,transform] duration-150
                     hover:border-input hover:shadow-sm hover:-translate-y-px
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <span className={cn(
            'w-6 h-6 rounded-md shrink-0 flex items-center justify-center text-[10px] font-bold tabular',
            i === 0 ? 'bg-primary/10 text-primary' : 'text-muted-foreground',
          )}>
            {i + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate
                          group-hover:text-primary transition-colors">
              {h.lead_name || 'Unknown'}
            </p>
            <p className="text-[11px] text-muted-foreground truncate">
              {h.company_name || h.phone || `${h.order_count} order${h.order_count === 1 ? '' : 's'}`}
            </p>
            <div className="h-1 bg-secondary rounded-full mt-1.5 overflow-hidden">
              <div className="h-full bg-primary/70 rounded-full transition-[width] duration-500"
                   style={{ width: `${max > 0 ? (h.coupons / max) * 100 : 0}%` }} />
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-semibold text-primary tabular">{h.coupons}</p>
            <p className="text-[10px] text-muted-foreground tabular">adv {money(h.total_advance)}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
