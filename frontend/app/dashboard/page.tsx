'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { isAuthenticated, getEmployee, hasPermission } from '@/lib/auth';
import { api } from '@/lib/api';
import {
  Users, Clock, ScanLine, Building2,
  FileSpreadsheet, RefreshCw, ArrowRight, TrendingUp, Trophy,
  CalendarDays, ChevronDown, X,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { NumberTicker } from '@/components/ui/number-ticker';
import { BlurFade } from '@/components/ui/blur-fade';
import { AnimatedList, AnimatedListItem } from '@/components/ui/animated-list';
import { cn } from '@/lib/utils';

interface AnalyticsSummary {
  total_leads: number;
  confirmed_count: number;
  pending_count: number;
  total_exhibitions: number;
  conversion_rate: number;
  leads_by_source?: Array<{ source: string; count: number }>;
}

const DONUT_COLORS = ['#3b82f6', '#f59e0b'];
const STATUS_COLORS: Record<string, string> = {
  confirmed: '#10b981',
  new: '#3b82f6',
  in_progress: '#8b5cf6',
  needs_correction: '#ef4444',
  pending: '#f59e0b',
};

const STATUS_BADGE: Record<string, string> = {
  confirmed: 'bg-emerald-100 text-emerald-700',
  new: 'bg-blue-100 text-blue-700',
  needs_correction: 'bg-red-100 text-red-700',
  in_progress: 'bg-violet-100 text-violet-700',
};

export default function DashboardPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [recentLeads, setRecentLeads] = useState<any[]>([]);
  const [allLeads, setAllLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [datePreset, setDatePreset] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const datePickerRef = useRef<HTMLDivElement>(null);

  const dateFilteredLeads = useMemo(() => {
    if (datePreset === 'all') return allLeads;
    const now = new Date();
    const to = datePreset === 'custom' && dateTo ? new Date(dateTo + 'T23:59:59') : now;
    const from = (() => {
      if (datePreset === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
      if (datePreset === 'week')  { const d = new Date(); d.setDate(d.getDate() - 7); return d; }
      if (datePreset === 'month') { const d = new Date(); d.setMonth(d.getMonth() - 1); return d; }
      if (datePreset === 'custom' && dateFrom) return new Date(dateFrom);
      return null;
    })();
    if (!from) return allLeads;
    return allLeads.filter(l => { const d = new Date(l.created_at); return d >= from && d <= to; });
  }, [allLeads, datePreset, dateFrom, dateTo]);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated()) { router.push('/auth/login'); return; }
    if (!hasPermission('view_dashboard')) { router.replace('/access-denied?from=/dashboard'); return; }
    loadData();
  }, [mounted, router]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node))
        setShowDatePicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const loadData = async (isRefresh = false) => {
    try {
      isRefresh ? setRefreshing(true) : setLoading(true);
      const employee = getEmployee();
      const [summaryData, leadsResp] = await Promise.all([
        api.getAnalyticsSummary(),
        api.getLeads({ limit: 2000, assigned_employee_id: employee?.employee_id }),
      ]);
      setSummary(summaryData);
      setAllLeads(leadsResp.leads);
      setRecentLeads(leadsResp.leads.slice(0, 8));
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  };

  if (!mounted || loading) {
    return (
      <div className="flex items-center justify-center h-64 bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          <p className="text-sm text-slate-500 font-medium">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  // All stats computed from dateFilteredLeads
  const totalLeads = dateFilteredLeads.length;
  const pending = dateFilteredLeads.filter(l => !l.status_code || l.status_code === 'new').length;
  const totalExhibitions = summary?.total_exhibitions ?? new Set(dateFilteredLeads.map((l: any) => l.exhibition_id)).size;
  const crmCount = dateFilteredLeads.filter(l => l.crm_ledger_id).length;

  const SOURCE_LABELS: Record<string, string> = {
    employee_scan: 'Card Scan',
    manual_entry: 'Manual Entry',
  };
  const scanVsManualData = (() => {
    const map: Record<string, number> = {};
    dateFilteredLeads.forEach((l: any) => { const s = l.source_code || 'other'; map[s] = (map[s] || 0) + 1; });
    return Object.entries(map).filter(([, v]) => v > 0)
      .map(([k, v]) => ({ name: SOURCE_LABELS[k] ?? k, value: v }));
  })();

  const statusBreakdown = (() => {
    const map: Record<string, number> = {};
    dateFilteredLeads.forEach(l => {
      const s = l.status_code || l.status || 'unknown';
      map[s] = (map[s] || 0) + 1;
    });
    const labels: Record<string, string> = {
      confirmed: 'Confirmed', new: 'New',
      in_progress: 'In Progress', needs_correction: 'Needs Fix', pending: 'Pending',
    };
    return Object.entries(map)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ name: labels[k] || k, value: v, key: k }))
      .sort((a, b) => b.value - a.value);
  })();

  const kpiCards = [
    { label: 'Cards Scanned', value: totalLeads, icon: ScanLine, iconBg: 'bg-blue-100', iconColor: 'text-blue-600', text: 'text-blue-600', link: '/leads' },
    { label: 'In CRM / ERP', value: crmCount, icon: FileSpreadsheet, iconBg: 'bg-emerald-100', iconColor: 'text-emerald-600', text: 'text-emerald-600', link: '/leads' },
    { label: 'Pending', value: pending, icon: Clock, iconBg: 'bg-amber-100', iconColor: 'text-amber-600', text: 'text-amber-600', link: '/leads' },
    { label: 'Exhibitions', value: totalExhibitions, icon: Building2, iconBg: 'bg-violet-100', iconColor: 'text-violet-600', text: 'text-violet-600', link: '/exhibitions' },
  ];

  const exhibitionData = (() => {
    const map: Record<string, { name: string; total: number; confirmed: number }> = {};
    dateFilteredLeads.forEach(lead => {
      const key = lead.exhibition_name || 'Unknown';
      if (!map[key]) map[key] = { name: key, total: 0, confirmed: 0 };
      map[key].total++;
      if (lead.status_code === 'confirmed' || lead.status === 'confirmed') map[key].confirmed++;
    });
    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 8);
  })();

  const DATE_PRESETS = [
    { key: 'all',    label: 'All Time'    },
    { key: 'today',  label: 'Today'       },
    { key: 'week',   label: 'Last 7 Days' },
    { key: 'month',  label: 'Last 30 Days'},
    { key: 'custom', label: 'Custom Range'},
  ];

  const activeDateLabel = (() => {
    const preset = DATE_PRESETS.find(p => p.key === datePreset);
    if (datePreset === 'custom' && dateFrom && dateTo)
      return `${dateFrom} → ${dateTo}`;
    if (datePreset === 'custom' && dateFrom)
      return `From ${dateFrom}`;
    return preset?.label ?? 'All Time';
  })();

  const quickActions = [
    { label: 'Scan Card', icon: ScanLine, href: '/chat', bg: 'bg-blue-100', color: 'text-blue-700' },
    { label: 'All Leads', icon: Users, href: '/leads', bg: 'bg-violet-100', color: 'text-violet-700' },
    { label: 'Exhibitions', icon: Building2, href: '/exhibitions', bg: 'bg-emerald-100', color: 'text-emerald-700' },
    { label: 'Report', icon: FileSpreadsheet, href: '/report', bg: 'bg-orange-100', color: 'text-orange-700' },
  ];

  return (
    <div className="bg-slate-50 min-h-full">

      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-10 md:min-h-[65px] flex items-center">
        <div className="px-4 md:px-6 py-4 md:py-0 flex items-center justify-between w-full">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
            <p className="text-xs text-slate-400 mt-0.5">Card Extraction Analytics</p>
          </div>

          <div className="flex items-center gap-2">
            {/* Date range picker — compact dropdown */}
            <div className="relative" ref={datePickerRef}>
              <button
                onClick={() => setShowDatePicker(v => !v)}
                className={cn(
                  'flex items-center gap-2 h-9 px-3 rounded-xl border text-sm font-medium transition-all',
                  datePreset !== 'all'
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                )}
              >
                <CalendarDays className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline max-w-[160px] truncate">{activeDateLabel}</span>
                <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
              </button>

              {showDatePicker && (
                <div className="absolute right-0 top-full mt-2 z-50 w-56 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
                  {/* Presets */}
                  <div className="p-1.5 space-y-0.5">
                    {DATE_PRESETS.map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => {
                          setDatePreset(key);
                          if (key !== 'custom') { setDateFrom(''); setDateTo(''); setShowDatePicker(false); }
                        }}
                        className={cn(
                          'w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                          datePreset === key
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-600 hover:bg-slate-100'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Custom date inputs */}
                  {datePreset === 'custom' && (
                    <div className="px-3 pb-3 pt-1 border-t border-slate-100 space-y-2">
                      <div>
                        <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">From</label>
                        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                          className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white" />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">To</label>
                        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                          className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white" />
                      </div>
                      {dateFrom && dateTo && (
                        <button onClick={() => setShowDatePicker(false)}
                          className="w-full py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition">
                          Apply
                        </button>
                      )}
                    </div>
                  )}

                  {/* Clear */}
                  {datePreset !== 'all' && (
                    <div className="px-3 pb-2.5 border-t border-slate-100 pt-1.5">
                      <button
                        onClick={() => { setDatePreset('all'); setDateFrom(''); setDateTo(''); setShowDatePicker(false); }}
                        className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 transition font-medium"
                      >
                        <X className="w-3 h-3" /> Clear filter
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {datePreset !== 'all' && (
              <span className="text-xs text-slate-400 hidden sm:inline">
                {dateFilteredLeads.length} of {allLeads.length}
              </span>
            )}

            <Button variant="ghost" size="icon" onClick={() => loadData(true)} disabled={refreshing} className="h-9 w-9 text-slate-500">
              <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
            </Button>
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-5 space-y-5">

        {/* KPI Cards */}
        <div className={`grid grid-cols-2 gap-3 ${kpiCards.length === 5 ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
          {kpiCards.map(({ label, value, icon: Icon, iconBg, iconColor, text, link }, i) => (
            <BlurFade key={label} delay={0.05 * i} inView className={kpiCards.length === 5 && i === 4 ? 'col-span-2 md:col-span-1' : ''}>
              <motion.div
                onClick={() => router.push(link)}
                whileHover={{ y: -3, boxShadow: '0 8px 30px -4px rgba(0,0,0,0.10)' }}
                transition={{ duration: 0.15 }}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 cursor-pointer"
              >
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center mb-3', iconBg)}>
                  <Icon className={cn('w-5 h-5', iconColor)} />
                </div>
                <div className={cn('text-2xl font-bold tabular-nums', text)}>
                  <NumberTicker value={value} />
                </div>
                <p className="text-xs text-slate-400 mt-0.5 font-medium">{label}</p>
              </motion.div>
            </BlurFade>
          ))}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Card Scan vs Manual Entry — Donut */}
          <BlurFade delay={0.2} inView>
            <Card className="shadow-sm border-slate-100 h-full">
              <CardHeader className="pb-1 pt-4 px-5">
                <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <span className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
                    <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
                  </span>
                  Card Scan vs Manual Entry
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5 pt-3">
                {scanVsManualData.length > 0 ? (
                  <div className="flex items-center gap-6">
                    <ResponsiveContainer width={170} height={170}>
                      <PieChart>
                        <Pie
                          data={scanVsManualData}
                          cx="50%" cy="50%"
                          innerRadius={52} outerRadius={78}
                          paddingAngle={3}
                          dataKey="value"
                          strokeWidth={0}
                        >
                          {scanVsManualData.map((_, i) => (
                            <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v) => [`${v} leads`]}
                          contentStyle={{ borderRadius: 10, fontSize: 12, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-3">
                      {scanVsManualData.map((d, i) => {
                        const pct = totalLeads > 0 ? Math.round((d.value / totalLeads) * 100) : 0;
                        return (
                          <div key={d.name}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: DONUT_COLORS[i] }} />
                                <span className="text-xs font-medium text-slate-600">{d.name}</span>
                              </div>
                              <span className="text-sm font-bold text-slate-800">{d.value}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: DONUT_COLORS[i] }} />
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5 text-right">{pct}%</p>
                          </div>
                        );
                      })}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-xs text-slate-400 font-medium">Total Leads</span>
                        <span className="text-base font-bold text-blue-600">{totalLeads}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-44 text-slate-300">
                    <ScanLine className="w-10 h-10 mb-2" />
                    <p className="text-sm">No leads yet</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </BlurFade>

          {/* Lead Status Breakdown — Bar */}
          <BlurFade delay={0.25} inView>
            <Card className="shadow-sm border-slate-100 h-full">
              <CardHeader className="pb-1 pt-4 px-5">
                <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <span className="w-6 h-6 bg-violet-100 rounded-lg flex items-center justify-center shrink-0">
                    <Users className="w-3.5 h-3.5 text-violet-600" />
                  </span>
                  Lead Status Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5 pt-3">
                {statusBreakdown.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart
                      data={statusBreakdown}
                      margin={{ top: 4, right: 8, left: -18, bottom: 0 }}
                      barSize={32}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 500 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        allowDecimals={false}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: '#f8fafc', radius: 6 }}
                        contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                        formatter={(v, _, props) => [v, props.payload?.name]}
                      />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]} name="Leads">
                        {statusBreakdown.map((entry) => (
                          <Cell key={entry.key} fill={STATUS_COLORS[entry.key] ?? '#94a3b8'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex flex-col items-center justify-center h-44 text-slate-300">
                    <Users className="w-10 h-10 mb-2" />
                    <p className="text-sm">No status data yet</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </BlurFade>
        </div>

        {/* Exhibition Comparison */}
        <BlurFade delay={0.28} inView>
          <Card className="shadow-sm border-slate-100">
            <CardHeader className="pb-2 pt-4 px-5 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <span className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
                  <Trophy className="w-3.5 h-3.5 text-blue-600" />
                </span>
                Exhibition Performance
              </CardTitle>
              <div className="flex items-center gap-4">
                <div className="hidden sm:flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span className="w-2.5 h-2.5 rounded-sm bg-blue-400 inline-block" />Total
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400 inline-block" />Confirmed
                  </div>
                </div>
                <span className="text-xs text-slate-400 font-medium">{exhibitionData.length} exhibitions</span>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5 pt-2">
              {exhibitionData.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-slate-300">
                  <Building2 className="w-10 h-10 mb-2" />
                  <p className="text-sm">No exhibition data yet</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={exhibitionData}
                    margin={{ top: 8, right: 12, left: -12, bottom: 48 }}
                    barCategoryGap="30%"
                    barGap={3}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 500 }}
                      angle={-35}
                      textAnchor="end"
                      interval={0}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#94a3b8' }}
                      allowDecimals={false}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: '#f8fafc', radius: 6 }}
                      contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                      formatter={(value, name) => [value, name === 'total' ? 'Total Leads' : 'Confirmed']}
                    />
                    <Bar dataKey="total" fill="#93c5fd" radius={[5, 5, 0, 0]} name="total" />
                    <Bar dataKey="confirmed" fill="#34d399" radius={[5, 5, 0, 0]} name="confirmed" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </BlurFade>

        {/* Quick Actions */}
        <BlurFade delay={0.3} inView>
          <Card className="shadow-sm border-slate-100">
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-sm font-semibold text-slate-700">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {quickActions.map(({ label, icon: Icon, href, bg, color }) => (
                  <motion.button
                    key={label}
                    onClick={() => router.push(href)}
                    whileHover={{ y: -3, boxShadow: '0 8px 24px -4px rgba(0,0,0,0.10)' }}
                    whileTap={{ scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                    className={cn('flex flex-col items-center gap-2.5 py-4 px-3 rounded-2xl font-semibold text-sm border border-transparent hover:border-slate-100 transition-all', bg, color)}
                  >
                    <Icon className="w-6 h-6" />{label}
                  </motion.button>
                ))}
              </div>
            </CardContent>
          </Card>
        </BlurFade>

        {/* Recent Leads */}
        <BlurFade delay={0.35} inView>
          <Card className="shadow-sm border-slate-100">
            <CardHeader className="pb-2 pt-4 px-5 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-semibold text-slate-700">Recently Scanned</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => router.push('/leads')} className="h-7 text-xs text-blue-600 hover:text-blue-700 gap-1 -mr-1">
                View all <ArrowRight className="w-3 h-3" />
              </Button>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              {recentLeads.length > 0 ? (
                <AnimatedList className="space-y-0.5">
                  {recentLeads.map(lead => (
                    <AnimatedListItem key={lead.lead_id}>
                      <motion.div
                        onClick={() => router.push(`/leads/${lead.lead_id}`)}
                        whileHover={{ x: 3 }}
                        transition={{ duration: 0.12 }}
                        className="flex items-center justify-between py-2 px-2 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors group -mx-1"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 text-xs font-bold shrink-0">
                            {(lead.primary_visitor_name || lead.company_name || '?')[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-800 truncate">
                              {lead.company_name || lead.primary_visitor_name || 'Unknown'}
                            </p>
                            {lead.primary_visitor_name && lead.company_name && (
                              <p className="text-xs text-slate-400 truncate">{lead.primary_visitor_name}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full',
                            STATUS_BADGE[lead.status] || STATUS_BADGE[lead.status_code] || 'bg-slate-100 text-slate-600'
                          )}>
                            {lead.status || lead.status_code || 'pending'}
                          </span>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-200 group-hover:text-blue-400 transition-colors" />
                        </div>
                      </motion.div>
                    </AnimatedListItem>
                  ))}
                </AnimatedList>
              ) : (
                <div className="flex flex-col items-center py-8 text-slate-300">
                  <ScanLine className="w-8 h-8 mb-2" /><p className="text-sm">No cards scanned yet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </BlurFade>

        <div className="md:hidden h-16" />
      </div>
    </div>
  );
}
