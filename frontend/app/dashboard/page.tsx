'use client';

/**
 * Dashboard.
 *
 * Covers the whole workflow, not just lead capture: leads, orders, the money
 * taken against them, and the lucky draw. Built mobile-first — a two-column
 * KPI grid on a phone widening to six, and charts that stack rather than
 * shrink into illegibility.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import {
  Users, ShoppingBag, IndianRupee, Wallet, Ticket, Scale,
  Loader2, RefreshCw, Smartphone, ChevronRight, Trophy, TrendingUp,
} from 'lucide-react';
import { api } from '@/lib/api';
import { isAuthenticated, hasPermission } from '@/lib/auth';
import type {
  Exhibition, Lead, OrderListItem, OrderListTotals, CouponHolder,
} from '@/lib/types';
import { money } from '@/lib/orders';

type Preset = 'today' | '7d' | '30d' | 'all';

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d',    label: '7 days' },
  { key: '30d',   label: '30 days' },
  { key: 'all',   label: 'All' },
];

// Deliberately distinguishable rather than a single-hue ramp: these are
// categories, not magnitudes.
const SERIES = ['#2563eb', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];

export default function DashboardPage() {
  const router = useRouter();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [totals, setTotals] = useState<OrderListTotals | null>(null);
  const [holders, setHolders] = useState<CouponHolder[]>([]);
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);

  const [exhibitionId, setExhibitionId] = useState('');
  const [preset, setPreset] = useState<Preset>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const canSeeOrders = hasPermission('manage_orders');

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    const exId = exhibitionId ? Number(exhibitionId) : undefined;
    try {
      // Every figure here is derived from the leads and orders themselves, so
      // the analytics summary endpoint would be a third request for numbers we
      // already hold — and one that ignores the date filter.
      const [leadResp, orderResp, coupons] = await Promise.all([
        api.getLeads({ exhibition_id: exId, limit: 2000 }).catch(() => ({ leads: [], count: 0 })),
        canSeeOrders
          ? api.searchOrders({ exhibition_id: exId, limit: 500 }).catch(() => null)
          : Promise.resolve(null),
        canSeeOrders
          ? api.getCouponHolders(exId).catch(() => [])
          : Promise.resolve([]),
      ]);
      setLeads(leadResp.leads);
      setOrders(orderResp?.orders ?? []);
      setTotals(orderResp?.totals ?? null);
      setHolders(coupons);
    } catch {
      toast.error('Could not load the dashboard');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [exhibitionId, canSeeOrders]);

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/auth/login'); return; }
    if (!hasPermission('view_dashboard')) { router.replace('/access-denied?from=/dashboard'); return; }
    api.getExhibitions().then(setExhibitions).catch(() => {});
  }, [router]);

  useEffect(() => { load(); }, [load]);

  /** Cut-off for the chosen preset; null means everything. */
  const since = useMemo(() => {
    const now = new Date();
    if (preset === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (preset === '7d')    return new Date(now.getTime() - 7 * 864e5);
    if (preset === '30d')   return new Date(now.getTime() - 30 * 864e5);
    return null;
  }, [preset]);

  const inRange = useCallback(
    (iso: string) => !since || new Date(iso) >= since,
    [since]
  );

  const shownLeads  = useMemo(() => leads.filter(l => inRange(l.created_at)), [leads, inRange]);
  const shownOrders = useMemo(() => orders.filter(o => inRange(o.created_at)), [orders, inRange]);

  // Order money is recomputed over the filtered set rather than reusing the
  // API totals, which cover everything — mixing the two would show a period's
  // order count beside an all-time value.
  const orderValue   = shownOrders.reduce((s, o) => s + o.effective_value, 0);
  const orderAdvance = shownOrders.reduce((s, o) => s + o.advance_amount, 0);
  const balanceDue   = Math.max(0, orderValue - orderAdvance);
  const pendingCustomer = totals?.pending_self_service ?? 0;

  const kpis = [
    { label: 'Leads',       value: String(shownLeads.length),  icon: Users,       tone: 'text-blue-600 bg-blue-50',       href: '/leads' },
    { label: 'Orders',      value: String(shownOrders.length), icon: ShoppingBag, tone: 'text-violet-600 bg-violet-50',   href: '/orders', ordersOnly: true },
    { label: 'Order value', value: money(orderValue),          icon: IndianRupee, tone: 'text-indigo-600 bg-indigo-50',   href: '/orders', ordersOnly: true },
    { label: 'Advance',     value: money(orderAdvance),        icon: Wallet,      tone: 'text-emerald-600 bg-emerald-50', href: '/orders', ordersOnly: true },
    { label: 'Balance due', value: money(balanceDue),          icon: Scale,       tone: 'text-rose-600 bg-rose-50',       href: '/orders', ordersOnly: true },
    { label: 'Coupons',     value: String(totals?.total_coupons ?? 0), icon: Ticket, tone: 'text-amber-600 bg-amber-50',  href: '/orders', ordersOnly: true },
  ].filter(k => canSeeOrders || !k.ordersOnly);

  const sourceData = useMemo(() => {
    const labels: Record<string, string> = {
      employee_scan: 'Card scan',
      manual_entry: 'Manual',
      self_service: 'Self-service',
    };
    const map: Record<string, number> = {};
    shownLeads.forEach(l => {
      const k = l.source_code || 'other';
      map[k] = (map[k] || 0) + 1;
    });
    return Object.entries(map).map(([k, v]) => ({ name: labels[k] ?? k, value: v }));
  }, [shownLeads]);

  const orderStatusData = useMemo(() => {
    const labels: Record<string, string> = {
      draft: 'Draft', confirmed: 'Confirmed', cancelled: 'Cancelled',
    };
    const map: Record<string, number> = {};
    shownOrders.forEach(o => { map[o.status_code] = (map[o.status_code] || 0) + 1; });
    return Object.entries(map).map(([k, v]) => ({ name: labels[k] ?? k, value: v }));
  }, [shownOrders]);

  /** Leads and orders per day, so capture and conversion read side by side. */
  const trend = useMemo(() => {
    const days = preset === 'today' ? 1 : preset === '7d' ? 7 : preset === '30d' ? 30 : 14;
    const buckets: { day: string; Leads: number; Orders: number }[] = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      buckets.push({
        day: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        Leads: 0, Orders: 0,
      });
    }
    const index = (iso: string) => {
      const d = new Date(iso);
      const diff = Math.floor(
        (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
          - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 864e5
      );
      return buckets.length - 1 - diff;
    };
    shownLeads.forEach(l => { const i = index(l.created_at); if (buckets[i]) buckets[i].Leads++; });
    shownOrders.forEach(o => { const i = index(o.created_at); if (buckets[i]) buckets[i].Orders++; });
    return buckets;
  }, [shownLeads, shownOrders, preset]);

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-slate-300" /></div>;
  }

  return (
    <div className="px-4 md:px-6 py-5 max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
          <TrendingUp className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-slate-900">Dashboard</h1>
          <p className="text-[11px] text-slate-400 truncate">
            {exhibitionId
              ? exhibitions.find(e => String(e.exhibition_id) === exhibitionId)?.name
              : 'All exhibitions'}
            {' · '}{PRESETS.find(p => p.key === preset)?.label}
          </p>
        </div>
        <button onClick={() => load(true)} disabled={refreshing} aria-label="Refresh"
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 shrink-0">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filters — stack on a phone, sit inline from sm up */}
      <div className="flex flex-col sm:flex-row gap-2">
        <select value={exhibitionId} onChange={e => setExhibitionId(e.target.value)}
                className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm sm:w-56">
          <option value="">All exhibitions</option>
          {exhibitions.map(e => (
            <option key={e.exhibition_id} value={e.exhibition_id}>{e.name}</option>
          ))}
        </select>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 overflow-x-auto">
          {PRESETS.map(p => (
            <button key={p.key} onClick={() => setPreset(p.key)}
                    className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                      preset === p.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                    }`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Work waiting — the only actionable thing here, so it sits above the numbers */}
      {canSeeOrders && pendingCustomer > 0 && (
        <button onClick={() => router.push('/orders')}
                className="w-full flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left hover:border-amber-300 transition-colors">
          <span className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
            <Smartphone className="w-4 h-4 text-amber-700" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-amber-900">
              {pendingCustomer} customer order{pendingCustomer === 1 ? '' : 's'} to confirm
            </span>
            <span className="block text-[11px] text-amber-700">Placed from the QR page</span>
          </span>
          <ChevronRight className="w-4 h-4 text-amber-600 shrink-0" />
        </button>
      )}

      {/* KPIs: 2 across on a phone, 3 on a tablet, all 6 on desktop */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {kpis.map(({ label, value, icon: Icon, tone, href }, i) => (
          <motion.button
            key={label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            onClick={() => router.push(href)}
            className="rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-slate-300 transition-colors"
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${tone}`}>
              <Icon className="w-4 h-4" />
            </div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400 leading-none">{label}</p>
            <p className="text-sm font-bold text-slate-900 truncate mt-1">{value}</p>
          </motion.button>
        ))}
      </div>

      {/* Charts stack on a phone — two 50%-width charts side by side would be
          unreadable at 360px. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartCard title="Where leads came from" empty={sourceData.length === 0}>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={sourceData} dataKey="value" nameKey="name"
                   cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={2}>
                {sourceData.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <Legend data={sourceData} />
        </ChartCard>

        {canSeeOrders && (
          <ChartCard title="Order status" empty={orderStatusData.length === 0}
                     emptyHint="No orders in this period">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={orderStatusData} dataKey="value" nameKey="name"
                     cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={2}>
                  {orderStatusData.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <Legend data={orderStatusData} />
          </ChartCard>
        )}
      </div>

      <ChartCard title="Leads and orders per day" empty={trend.every(t => !t.Leads && !t.Orders)}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94a3b8' }}
                   interval="preserveStartEnd" axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} allowDecimals={false}
                   axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: '#f8fafc' }} />
            <Bar dataKey="Leads"  fill={SERIES[0]} radius={[3, 3, 0, 0]} />
            {canSeeOrders && <Bar dataKey="Orders" fill={SERIES[2]} radius={[3, 3, 0, 0]} />}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Lucky draw standings */}
      {canSeeOrders && holders.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Lucky draw leaders
            </span>
            <button onClick={() => router.push('/orders')}
                    className="ml-auto text-[11px] text-blue-600 hover:underline">
              See all
            </button>
          </div>
          <div className="space-y-2">
            {holders.slice(0, 5).map((h, i) => (
              <button key={h.lead_id} onClick={() => router.push(`/leads/${h.lead_id}`)}
                      className="w-full flex items-center gap-2.5 text-left">
                <span className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold ${
                  i === 0 ? 'bg-amber-100 text-amber-700' : 'text-slate-400'
                }`}>{i + 1}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-medium text-slate-800 truncate">
                    {h.lead_name || 'Unknown'}
                  </span>
                  <span className="block h-1 bg-slate-100 rounded-full mt-1 overflow-hidden">
                    <span className="block h-full bg-amber-400 rounded-full"
                          style={{ width: `${(h.coupons / holders[0].coupons) * 100}%` }} />
                  </span>
                </span>
                <span className="text-xs font-bold text-amber-700 shrink-0">{h.coupons}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ChartCard({ title, children, empty, emptyHint }: {
  title: string; children: React.ReactNode; empty?: boolean; emptyHint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{title}</p>
      {empty ? (
        <p className="text-[11px] text-slate-400 py-12 text-center">
          {emptyHint ?? 'Nothing in this period'}
        </p>
      ) : children}
    </div>
  );
}

/** Own legend rather than recharts': theirs wraps badly under 380px. */
function Legend({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
      {data.map((d, i) => (
        <span key={d.name} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: SERIES[i % SERIES.length] }} />
          {d.name}
          <span className="text-slate-400">
            {d.value}{total > 0 ? ` · ${Math.round((d.value / total) * 100)}%` : ''}
          </span>
        </span>
      ))}
    </div>
  );
}
