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
import { usePermission } from '@/lib/usePermission';
import type {
  Exhibition, Lead, OrderListItem, OrderListTotals, CouponHolder,
} from '@/lib/types';
import { money } from '@/lib/orders';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import DateFilter, {
  type DatePreset, datePresetStart, datePresetEnd,
} from '@/components/DateFilter';

// Drawn from the theme's chart tokens so the charts move with the palette
// instead of holding a second, contradictory set of colours. Distinguishable
// rather than a single-hue ramp — these label categories, not magnitudes.
const SERIES = [
  'hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))',
  'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(var(--chart-6))',
];

export default function DashboardPage() {
  const router = useRouter();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [totals, setTotals] = useState<OrderListTotals | null>(null);
  const [holders, setHolders] = useState<CouponHolder[]>([]);
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);

  const [exhibitionId, setExhibitionId] = useState('');
  const [preset, setPreset] = useState<DatePreset>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const canSeeOrders = usePermission('manage_orders');

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

  /** Window for the chosen preset; nulls mean unbounded on that side. */
  const since  = useMemo(() => datePresetStart(preset), [preset]);
  const until = useMemo(() => datePresetEnd(preset), [preset]);

  const inRange = useCallback(
    (iso: string) => {
      const t = new Date(iso);
      return (!since || t >= since) && (!until || t < until);
    },
    [since, until]
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

  // Tone is used sparingly and with meaning: money owed reads as a warning,
  // money received as success, everything else stays neutral. Six differently
  // coloured cards would be decoration, not information.
  const kpis: {
    label: string; value: string; icon: typeof Users;
    tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
    hint?: string; href: string; ordersOnly?: boolean;
  }[] = [
    { label: 'Leads',  value: String(shownLeads.length),  icon: Users, tone: 'primary' as const, href: '/leads' },
    { label: 'Orders', value: String(shownOrders.length), icon: ShoppingBag, href: '/orders', ordersOnly: true,
      hint: pendingCustomer > 0 ? `${pendingCustomer} to confirm` : undefined },
    { label: 'Order value', value: money(orderValue),   icon: IndianRupee, href: '/orders', ordersOnly: true },
    { label: 'Advance',     value: money(orderAdvance), icon: Wallet, tone: 'success' as const, href: '/orders', ordersOnly: true,
      hint: orderValue > 0 ? `${Math.round((orderAdvance / orderValue) * 100)}% collected` : undefined },
    { label: 'Balance due', value: money(balanceDue), icon: Scale,
      tone: balanceDue > 0 ? ('warning' as const) : ('neutral' as const),
      href: '/orders', ordersOnly: true },
    { label: 'Coupons', value: String(totals?.total_coupons ?? 0), icon: Ticket, href: '/orders', ordersOnly: true },
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
    const days =
      preset === 'today' || preset === 'yesterday' ? 1
      : preset === '7d'    ? 7
      : preset === '30d'   ? 30
      : preset === 'month' ? new Date().getDate()
      : 14;
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
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <>
      <PageHeader
        icon={TrendingUp}
        title="Dashboard"
        filters={<>
          {/* flex-1 on a phone so the two share one row evenly; fixed widths
              from sm so they fit beside the title at 768px without pushing the
              header past the sidebar's 65px. */}
          <select value={exhibitionId} onChange={e => setExhibitionId(e.target.value)}
                  className="h-9 px-2.5 rounded-lg border border-border bg-card text-sm text-foreground
                             focus:outline-none focus:ring-2 focus:ring-ring/30
                             flex-1 min-w-0 sm:flex-none sm:w-40 lg:w-52">
            <option value="">All exhibitions</option>
            {exhibitions.map(e => (
              <option key={e.exhibition_id} value={e.exhibition_id}>{e.name}</option>
            ))}
          </select>
          <DateFilter value={preset} onChange={setPreset}
                      className="flex-1 min-w-0 sm:flex-none sm:w-36 lg:w-44" />
        </>}
        actions={
          <Button variant="ghost" size="icon" onClick={() => load(true)}
                  disabled={refreshing} aria-label="Refresh">
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
          </Button>
        }
      />

      {/* Wide cap rather than max-w-6xl: on a 1080p monitor that left roughly a
          third of the window empty on either side of the charts. */}
      <div className="px-4 md:px-6 py-4 max-w-[1600px] mx-auto space-y-3">

      {/* Work waiting — the only actionable thing here, so it sits above the numbers */}
      {canSeeOrders && pendingCustomer > 0 && (
        <button onClick={() => router.push('/orders')}
                className="group w-full flex items-center gap-3 rounded-lg border border-warning/25
                           bg-warning/[0.07] px-3.5 py-2.5 text-left
                           hover:border-warning/40 hover:bg-warning/10 transition-colors">
          <span className="rounded-md bg-warning/15 p-1.5 shrink-0">
            <Smartphone className="w-3.5 h-3.5 text-warning" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-foreground">
              {pendingCustomer} customer order{pendingCustomer === 1 ? '' : 's'} waiting to be confirmed
            </span>
            <span className="block text-[11px] text-muted-foreground">Placed from the QR page at the stall</span>
          </span>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
        </button>
      )}

      {/* KPIs: 2 across on a phone, 3 on a tablet, all 6 on desktop */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 auto-rows-fr">
        {kpis.map(({ label, value, icon, tone, hint, href }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03, duration: 0.2 }}
          >
            <StatCard
              label={label} value={value} icon={icon} tone={tone} hint={hint}
              onClick={() => router.push(href)}
              className="h-full"
            />
          </motion.div>
        ))}
      </div>

      {/* The two donuts always share a row — at 2 columns even on a phone. The
          per-day chart needs width to stay legible, so it spans both until 2xl
          where all three fit on one line. */}
      <div className="grid grid-cols-2 2xl:grid-cols-3 gap-2.5 sm:gap-3">
        <ChartCard title="Where leads came from" empty={sourceData.length === 0}>
          <Donut data={sourceData} />
        </ChartCard>

        {canSeeOrders && (
          <ChartCard title="Order status" empty={orderStatusData.length === 0}
                     emptyHint="No orders in this period">
            <Donut data={orderStatusData} />
          </ChartCard>
        )}

        <ChartCard
          title="Leads and orders per day"
          empty={trend.every(t => !t.Leads && !t.Orders)}
          className="col-span-2 2xl:col-span-1"
        >
          {/* Same height as the donuts, so the three cards in the row match and
              none of them stretches to leave a void under its chart. */}
          <ResponsiveContainer width="100%" height={168}>
            <BarChart data={trend} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                     interval="preserveStartEnd" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false}
                     axisLine={false} tickLine={false} width={32} />
              <Tooltip cursor={{ fill: 'hsl(var(--secondary))' }} content={<ChartTooltip />} />
              <Bar dataKey="Leads"  fill={SERIES[0]} radius={[3, 3, 0, 0]} maxBarSize={22} />
              {canSeeOrders && <Bar dataKey="Orders" fill={SERIES[1]} radius={[3, 3, 0, 0]} maxBarSize={22} />}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Lucky draw standings */}
      {canSeeOrders && holders.length > 0 && (
        <Panel
          title="Lucky draw leaders"
          icon={Trophy}
          action={
            <button onClick={() => router.push('/orders')}
                    className="text-[11px] font-medium text-primary hover:underline">
              See all
            </button>
          }
        >
          <div className="space-y-2.5">
            {holders.slice(0, 5).map((h, i) => (
              <button key={h.lead_id} onClick={() => router.push(`/leads/${h.lead_id}`)}
                      className="w-full flex items-center gap-2.5 text-left group">
                <span className={cn(
                  'w-5 h-5 rounded-md shrink-0 flex items-center justify-center text-[10px] font-bold tabular',
                  i === 0 ? 'bg-primary/10 text-primary' : 'text-muted-foreground',
                )}>
                  {i + 1}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-medium text-foreground truncate
                                   group-hover:text-primary transition-colors">
                    {h.lead_name || 'Unknown'}
                  </span>
                  <span className="block h-1 bg-secondary rounded-full mt-1.5 overflow-hidden">
                    <span className="block h-full bg-primary/70 rounded-full transition-[width] duration-500"
                          style={{ width: `${(h.coupons / holders[0].coupons) * 100}%` }} />
                  </span>
                </span>
                <span className="text-xs font-semibold text-foreground shrink-0 tabular">{h.coupons}</span>
              </button>
            ))}
          </div>
        </Panel>
      )}
      </div>
    </>
  );
}

/** Recharts' default tooltip is a white box with a grey border — off-palette. */
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-2.5 py-1.5 shadow-md">
      <p className="text-[10px] font-medium text-muted-foreground mb-0.5">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: p.color }} />
          {p.name}
          <span className="tabular ml-auto pl-3">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

function ChartCard({ title, children, empty, emptyHint, className = '' }: {
  title: string; children: React.ReactNode;
  empty?: boolean; emptyHint?: string; className?: string;
}) {
  return (
    <Panel title={title} className={className} bodyClassName="flex flex-col">
      {empty ? (
        <p className="text-[11px] text-muted-foreground flex-1 flex items-center justify-center text-center py-10">
          {emptyHint ?? 'Nothing in this period'}
        </p>
      ) : children}
    </Panel>
  );
}

/**
 * Donut with its legend beside it rather than beneath.
 *
 * Stacked, a 160px circle sat in the middle of a 550px card with the legend as
 * a single short line under it — most of the card was empty. Side by side the
 * legend takes the width the chart does not need. Falls back to stacked below
 * sm, where there is no width to share.
 */
function Donut({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="flex flex-col lg:flex-row items-center justify-center gap-2 lg:gap-3 flex-1">
      {/* The total sits in the hole rather than in a caption — it is the one
          number every reader wants and the ring already frames the space.
          Radii are percentages, not pixels: these cards are half-width on a
          phone, and a fixed 68px outer radius would be clipped by the card. */}
      <div className="w-full lg:w-[45%] lg:max-w-[172px] shrink-0 relative">
        <ResponsiveContainer width="100%" height={132}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
                 innerRadius="62%" outerRadius="92%" paddingAngle={2}
                 stroke="hsl(var(--card))" strokeWidth={2}>
              {data.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-lg font-semibold text-foreground tabular leading-none">{total}</span>
          <span className="text-[9px] text-muted-foreground mt-0.5">total</span>
        </div>
      </div>

      {/* Own legend rather than recharts': theirs wraps badly under 380px. */}
      <div className="flex-1 min-w-0 w-full flex flex-col gap-y-1 lg:gap-y-2">
        {data.map((d, i) => (
          <span key={d.name} className="inline-flex items-center gap-1.5 text-[10px] lg:text-[11px] text-muted-foreground min-w-0">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: SERIES[i % SERIES.length] }} />
            <span className="truncate text-foreground">{d.name}</span>
            <span className="shrink-0 ml-auto tabular">
              {d.value}{total > 0 ? ` · ${Math.round((d.value / total) * 100)}%` : ''}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
