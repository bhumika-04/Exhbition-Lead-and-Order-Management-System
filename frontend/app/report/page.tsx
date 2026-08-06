'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { requireAuth, hasPermission } from '@/lib/auth';
import type { Lead, LeadDetails, Exhibition } from '@/lib/types';
import {
  FileSpreadsheet, Search, Download, Users, Calendar,
  AlertTriangle, Filter, ChevronRight, ChevronLeft, X, ChevronDown,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BlurFade } from '@/components/ui/blur-fade';
import { NumberTicker } from '@/components/ui/number-ticker';
import { cn } from '@/lib/utils';

// Pull the first number out of a free-text value, e.g. "10 Cr" -> 10, "80 employees" -> 80
const parseLeadingNumber = (s?: string | null): number | null => {
  if (!s) return null;
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

export default function ReportPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [detailsMap, setDetailsMap] = useState<Map<number, LeadDetails>>(new Map());
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailsProgress, setDetailsProgress] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Filters
  const [filterExhibitionId, setFilterExhibitionId] = useState<number | ''>('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterServices, setFilterServices] = useState<string[]>([]);
  const [filterCity, setFilterCity] = useState('');
  const [filterState, setFilterState] = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterVertical, setFilterVertical] = useState('');
  const [turnoverMin, setTurnoverMin] = useState('');
  const [turnoverMax, setTurnoverMax] = useState('');
  const [teamMin, setTeamMin] = useState('');
  const [teamMax, setTeamMax] = useState('');
  const [showServicesDropdown, setShowServicesDropdown] = useState(false);
  const servicesDropdownRef = useRef<HTMLDivElement>(null);
  const servicesBtnRef = useRef<HTMLButtonElement>(null);
  const [svcDropPos, setSvcDropPos] = useState({ top: 0, left: 0, width: 260 });

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  // Inline editing
  const [editingCell, setEditingCell] = useState<{ leadId: number; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');

  const VERTICAL_OPTIONS = ['Packaging', 'Commercial', 'Flexo Label', 'Publication', 'Corrugation', 'Large Format'];

  const startEdit = (e: React.MouseEvent, leadId: number, field: string, currentValue: string) => {
    e.stopPropagation();
    setEditingCell({ leadId, field });
    setEditValue(currentValue || '');
  };

  const saveEdit = async (leadId: number, originalLead: Lead) => {
    if (!editingCell || editingCell.leadId !== leadId) return;
    const field = editingCell.field;
    const value = editValue.trim();
    setEditingCell(null);
    setLeads(prev => prev.map(l => l.lead_id === leadId ? { ...l, [field]: value } : l));
    try {
      await api.updateLead(leadId, { [field]: value } as any);
    } catch {
      toast.error('Failed to save');
      setLeads(prev => prev.map(l => l.lead_id === leadId ? originalLead : l));
    }
  };

  // Resizable columns
  const thRefs = useRef<(HTMLTableCellElement | null)[]>([]);
  const isResizing = useRef<number | null>(null);
  const startX = useRef(0);
  const startWidth = useRef(0);

  useEffect(() => {
    try { requireAuth(); } catch { router.push('/auth/login'); return; }
    if (!hasPermission('view_report')) { router.replace('/access-denied?from=/report'); return; }
    loadData();
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (isResizing.current === null) return;
      const th = thRefs.current[isResizing.current];
      if (!th) return;
      const newWidth = Math.max(60, startWidth.current + (e.clientX - startX.current));
      th.style.minWidth = `${newWidth}px`;
      th.style.width = `${newWidth}px`;
    };
    const onMouseUp = () => { isResizing.current = null; document.body.style.cursor = ''; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
  }, []);

  const startResize = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = index;
    startX.current = e.clientX;
    startWidth.current = thRefs.current[index]?.offsetWidth ?? 120;
    document.body.style.cursor = 'col-resize';
  };

  const loadData = async () => {
    try {
      const [leadsResult, exhibitionsResult] = await Promise.all([
        api.getLeads({ limit: 5000 }),
        api.getExhibitions(),
      ]);
      setLeads(leadsResult.leads);
      setExhibitions(exhibitionsResult);
      // Details are fetched lazily per page — see useEffect below
    } catch (error) {
      console.error('Failed to load:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // Fetch details only for the leads visible on the current page
  const fetchPageDetails = async (ids: number[]) => {
    const missing = ids.filter(id => !detailsMap.has(id));
    if (missing.length === 0) return;
    setDetailsProgress(1); // show spinner
    const map = new Map(detailsMap);
    const batchSize = 10;
    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(id => api.getLead(id).catch(() => null)));
      results.forEach((detail, idx) => { if (detail) map.set(batch[idx], detail); });
      setDetailsMap(new Map(map));
    }
    setDetailsProgress(0);
  };

  // Close services dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideBtn = servicesBtnRef.current?.contains(target);
      const insideDrop = servicesDropdownRef.current?.contains(target);
      if (!insideBtn && !insideDrop) setShowServicesDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredLeads = useMemo(() => {
    let result = leads;
    if (filterExhibitionId !== '') result = result.filter((l) => l.exhibition_id === filterExhibitionId);
    if (filterPriority) result = result.filter((l) => l.priority === filterPriority);
    if (filterStatus) result = result.filter((l) => l.status_code === filterStatus);
    if (filterDateFrom) result = result.filter((l) => new Date(l.created_at) >= new Date(filterDateFrom));
    if (filterDateTo) result = result.filter((l) => new Date(l.created_at) <= new Date(filterDateTo + 'T23:59:59'));
    if (filterServices.length > 0) {
      result = result.filter((l) => {
        // Use detail map if loaded, fall back to services_json from list API
        const d = detailsMap.get(l.lead_id);
        const svcTexts = d
          ? d.services?.map((s: any) => (s.service_text || s).toLowerCase()) ?? []
          : (() => { try { return (JSON.parse(l.services_json || '[]') as any[]).map(s => (s.service_text || s || '').toLowerCase()); } catch { return []; } })();
        return filterServices.some(sel => svcTexts.some(t => t.includes(sel.toLowerCase())));
      });
    }
    if (filterCity) result = result.filter(l => l.city?.toLowerCase() === filterCity.toLowerCase());
    if (filterState) result = result.filter(l => l.state?.toLowerCase() === filterState.toLowerCase());
    if (filterCountry) result = result.filter(l => {
      const d = detailsMap.get(l.lead_id);
      return d?.addresses?.some(a => a.country?.toLowerCase().includes(filterCountry.toLowerCase()));
    });
    if (filterCategory) result = result.filter(l => l.category === filterCategory);
    if (filterVertical) result = result.filter(l => l.vertical === filterVertical);
    // Turn-over / Team-size are free text — parse the leading number and match the Min/Max range
    if (turnoverMin || turnoverMax) {
      const min = turnoverMin ? parseFloat(turnoverMin) : -Infinity;
      const max = turnoverMax ? parseFloat(turnoverMax) : Infinity;
      result = result.filter(l => { const n = parseLeadingNumber(l.turn_over); return n !== null && n >= min && n <= max; });
    }
    if (teamMin || teamMax) {
      const min = teamMin ? parseFloat(teamMin) : -Infinity;
      const max = teamMax ? parseFloat(teamMax) : Infinity;
      result = result.filter(l => { const n = parseLeadingNumber(l.team_size); return n !== null && n >= min && n <= max; });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(l => {
        const displayName = (l.primary_visitor_name || 'unknown visitor').toLowerCase();
        return (
          displayName.includes(q) ||
          l.company_name?.toLowerCase().includes(q) ||
          l.primary_visitor_phone?.includes(q) ||
          l.primary_visitor_email?.toLowerCase().includes(q)
        );
      });
    }
    return result;
  }, [leads, detailsMap, searchQuery, filterExhibitionId, filterPriority, filterStatus, filterDateFrom, filterDateTo, filterServices, filterCity, filterState, filterCountry, filterCategory, filterVertical, turnoverMin, turnoverMax, teamMin, teamMax]);

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [searchQuery, filterExhibitionId, filterPriority, filterStatus, filterDateFrom, filterDateTo, filterServices, filterCity, filterState, filterCountry, filterCategory, filterVertical, turnoverMin, turnoverMax, teamMin, teamMax]);

  const totalPages = Math.ceil(filteredLeads.length / PAGE_SIZE);
  const pagedLeads = filteredLeads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Fetch details only for the current page (lazy loading)
  useEffect(() => {
    if (loading) return;
    const ids = pagedLeads.map(l => l.lead_id);
    fetchPageDetails(ids);
  }, [pagedLeads, loading]);

  const activeFilterCount = [
    filterExhibitionId !== '', filterPriority, filterStatus,
    filterDateFrom, filterDateTo, filterServices.length > 0,
    filterCity, filterState, filterCountry,
    filterCategory, filterVertical,
    turnoverMin || turnoverMax, teamMin || teamMax,
  ].filter(Boolean).length;

  const allCategories = useMemo(() => {
    const cats = leads.map(l => l.category).filter(Boolean) as string[];
    return Array.from(new Set(cats)).sort();
  }, [leads]);

  const allVerticals = useMemo(() => {
    const vs = leads.map(l => l.vertical).filter(Boolean) as string[];
    return Array.from(new Set(vs)).sort();
  }, [leads]);

  const servicesSuggestions = useMemo(() => {
    // Parse from full leads list (services_json) for instant availability of all services
    const all: string[] = leads.flatMap(l => {
      try { return (JSON.parse(l.services_json || '[]') as any[]).map(s => s.service_text || s).filter(Boolean); }
      catch { return []; }
    });
    return Array.from(new Set(all)).sort();
  }, [leads]);

  const uniqueStates = useMemo(() =>
    Array.from(new Set(leads.map(l => l.state).filter(Boolean) as string[])).sort()
  , [leads]);

  const uniqueCities = useMemo(() => {
    const source = filterState
      ? leads.filter(l => l.state?.toLowerCase() === filterState.toLowerCase())
      : leads;
    return Array.from(new Set(source.map(l => l.city).filter(Boolean) as string[])).sort();
  }, [leads, filterState]);

  const clearAllFilters = () => {
    setFilterExhibitionId(''); setFilterPriority(''); setFilterStatus('');
    setFilterDateFrom(''); setFilterDateTo(''); setFilterServices([]);
    setFilterCity(''); setFilterState(''); setFilterCountry('');
    setFilterCategory(''); setFilterVertical('');
    setTurnoverMin(''); setTurnoverMax(''); setTeamMin(''); setTeamMax('');
  };

  const now = new Date();
  const thisMonthCount = leads.filter((l) => {
    const d = new Date(l.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const highPriorityCount = leads.filter((l) => l.priority === 'high').length;

  const fmt = (val?: string | null) => val || '—';
  const fmtDate = (iso?: string) =>
    iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

  const exportCSV = () => {
    const headers = [
      'S.No', 'Exhibition', 'Company Name', 'Client Name',
      'Services', 'Email', 'Website', 'Post',
      'Address', 'State', 'City', 'Mobile No.',
      'Remark', 'Team Member', 'Priority', 'Created Date',
    ];
    const esc = (val?: string | null) => {
      if (!val) return '';
      return `"${val.replace(/"/g, '""')}"`;
    };
    const rows = filteredLeads.map((lead, i) => {
      const d = detailsMap.get(lead.lead_id);
      const addr = d?.addresses?.[0];
      const web = d?.websites?.[0]?.website_url || '';
      const emailVal = d?.emails?.[0]?.email_address || lead.primary_visitor_email || '';
      const phoneVal = d?.phones?.[0]?.phone_number || lead.primary_visitor_phone || '';
      const services = d?.services?.map((s: any) => s.service_text || s).join('; ') || '';
      return [
        i + 1, esc(lead.exhibition_name), esc(lead.company_name), esc(lead.primary_visitor_name),
        esc(services), esc(emailVal), esc(web), esc(lead.primary_visitor_designation),
        esc(addr?.address_text), esc(addr?.state), esc(addr?.city), esc(phoneVal),
        esc(lead.discussion_summary), esc(lead.assigned_employee_name),
        esc(lead.priority), fmtDate(lead.created_at),
      ].join(',');
    });
    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads_${now.toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredLeads.length} leads`);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          <p className="text-sm text-slate-500 font-medium">Loading report data…</p>
          {detailsProgress > 0 && (
            <div className="text-center w-48">
              <p className="text-xs text-slate-400 mb-2">{detailsProgress}% complete</p>
              <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 rounded-full transition-all duration-300" style={{ width: `${detailsProgress}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }


  const kpiCards = [
    { label: 'Total Leads', value: leads.length, icon: Users, iconBg: 'bg-blue-100', iconColor: 'text-blue-600', text: 'text-blue-600' },
    { label: 'This Month', value: thisMonthCount, icon: Calendar, iconBg: 'bg-violet-100', iconColor: 'text-violet-600', text: 'text-violet-600' },
    { label: 'High Priority', value: highPriorityCount, icon: AlertTriangle, iconBg: 'bg-rose-100', iconColor: 'text-rose-600', text: 'text-rose-600' },
  ];

  // Column definitions: index maps to thRefs
  const COL_SNO = 0;
  const COL_COMPANY = 1;
  const COL_PERSON = 2;
  const snoWidth = 48;
  const companyWidth = 150;
  const personWidth = 130;

  return (
    <div className="bg-slate-50 min-h-full">

      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-20 md:min-h-[65px] flex items-center">
        <div className="px-4 md:px-6 py-4 md:py-0 w-full">
          <h1 className="text-xl font-bold text-slate-900">Report &amp; Export</h1>
          <p className="text-xs text-slate-400 mt-0.5">{leads.length} leads total</p>
        </div>
      </div>

      <div className="px-4 md:px-6 py-5 space-y-5">

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {kpiCards.map(({ label, value, icon: Icon, iconBg, iconColor, text }, i) => (
            <BlurFade key={label} delay={0.05 * i} inView>
              <motion.div
                whileHover={{ y: -3, boxShadow: '0 8px 30px -4px rgba(0,0,0,0.10)' }}
                transition={{ duration: 0.15 }}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4"
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

        {/* Toolbar: Search + Filter + Export */}
        <BlurFade delay={0.2} inView>
          <Card className="shadow-sm border-slate-100">
            <CardContent className="px-4 py-3 space-y-3">
              {/* Row */}
              <div className="flex gap-2 items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    type="text"
                    placeholder="Search by name, company, phone, email…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 rounded-xl border-slate-200 bg-slate-50 focus:bg-white h-9"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFilters(!showFilters)}
                  className={cn('h-9 gap-1.5 px-3 rounded-xl border-slate-200 shrink-0', showFilters && 'bg-blue-50 border-blue-200 text-blue-600')}
                >
                  <Filter className="w-4 h-4" />
                  <span className="hidden sm:inline">Filters</span>
                  {activeFilterCount > 0 && (
                    <span className="bg-blue-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                      {activeFilterCount}
                    </span>
                  )}
                </Button>
                <motion.button
                  onClick={exportCSV}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  className="flex items-center gap-1.5 h-9 px-3 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 transition-colors shadow-sm shrink-0"
                >
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">Export CSV</span>
                </motion.button>
                {detailsProgress > 0 && (
                  <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
                )}
              </div>

              {/* Filter Panel */}
              {showFilters && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  style={{ overflow: 'visible' }}
                >
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 pt-1">
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">Exhibition</label>
                      <select
                        value={filterExhibitionId}
                        onChange={(e) => setFilterExhibitionId(e.target.value ? parseInt(e.target.value) : '')}
                        className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white text-slate-700"
                      >
                        <option value="">All</option>
                        {exhibitions.map((ex) => (
                          <option key={ex.exhibition_id} value={ex.exhibition_id}>{ex.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">Priority</label>
                      <select
                        value={filterPriority}
                        onChange={(e) => setFilterPriority(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white text-slate-700"
                      >
                        <option value="">All</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">Status</label>
                      <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white text-slate-700"
                      >
                        <option value="">All</option>
                        <option value="new">New</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="needs_correction">Needs Correction</option>
                        <option value="in_progress">In Progress</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">Date From</label>
                      <input
                        type="date"
                        value={filterDateFrom}
                        onChange={(e) => setFilterDateFrom(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white text-slate-700"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">Date To</label>
                      <input
                        type="date"
                        value={filterDateTo}
                        onChange={(e) => setFilterDateTo(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white text-slate-700"
                      />
                    </div>
                    {/* Services multi-select */}
                    <div className="relative" ref={servicesDropdownRef}>
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">Services</label>
                      <button
                        ref={servicesBtnRef}
                        type="button"
                        onClick={() => {
                          if (servicesBtnRef.current) {
                            const r = servicesBtnRef.current.getBoundingClientRect();
                            setSvcDropPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 260) });
                          }
                          setShowServicesDropdown(v => !v);
                        }}
                        className={cn(
                          'w-full flex items-center justify-between text-xs border rounded-lg px-2 py-1.5 bg-white text-left',
                          filterServices.length > 0 ? 'border-blue-400 text-blue-700' : 'border-slate-200 text-slate-500'
                        )}
                      >
                        <span className="truncate">
                          {filterServices.length === 0 ? 'All Services' : filterServices.length === 1 ? filterServices[0] : `${filterServices.length} selected`}
                        </span>
                        <ChevronDown className="w-3 h-3 shrink-0 ml-1 text-slate-400" />
                      </button>
                      {/* Dropdown rendered via portal at end of page — see below */}
                    </div>

                    {/* State */}
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">State</label>
                      <select value={filterState} onChange={e => { setFilterState(e.target.value); setFilterCity(''); }}
                        className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white text-slate-700">
                        <option value="">All</option>
                        {uniqueStates.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>

                    {/* City */}
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">City</label>
                      <select value={filterCity} onChange={e => setFilterCity(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white text-slate-700">
                        <option value="">All</option>
                        {uniqueCities.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>

                    {/* Country */}
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">Country</label>
                      <input type="text" value={filterCountry} onChange={e => setFilterCountry(e.target.value)}
                        placeholder="e.g. India"
                        className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white text-slate-700" />
                    </div>

                    {/* Category */}
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">Category</label>
                      <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white text-slate-700">
                        <option value="">All</option>
                        {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>

                    {/* Vertical */}
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">Vertical</label>
                      <select value={filterVertical} onChange={e => setFilterVertical(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white text-slate-700">
                        <option value="">All</option>
                        {allVerticals.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>

                    {/* Turnover range (Cr) */}
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">Turnover (Cr)</label>
                      <div className="flex items-center gap-1">
                        <input type="number" inputMode="decimal" value={turnoverMin} onChange={e => setTurnoverMin(e.target.value)}
                          placeholder="Min"
                          className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white text-slate-700" />
                        <span className="text-slate-300 text-xs">–</span>
                        <input type="number" inputMode="decimal" value={turnoverMax} onChange={e => setTurnoverMax(e.target.value)}
                          placeholder="Max"
                          className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white text-slate-700" />
                      </div>
                    </div>

                    {/* Team size range (employees) */}
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">Team Size</label>
                      <div className="flex items-center gap-1">
                        <input type="number" inputMode="numeric" value={teamMin} onChange={e => setTeamMin(e.target.value)}
                          placeholder="Min"
                          className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white text-slate-700" />
                        <span className="text-slate-300 text-xs">–</span>
                        <input type="number" inputMode="numeric" value={teamMax} onChange={e => setTeamMax(e.target.value)}
                          placeholder="Max"
                          className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white text-slate-700" />
                      </div>
                    </div>
                  </div>
                  {activeFilterCount > 0 && (
                    <button
                      onClick={clearAllFilters}
                      className="mt-2 text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                    >
                      <X className="w-3 h-3" /> Clear all filters
                    </button>
                  )}
                </motion.div>
              )}

              <p className="text-xs text-slate-400 flex items-center gap-2">
                Showing <span className="font-semibold text-slate-600">{filteredLeads.length}</span> of {leads.length} leads
                {detailsProgress > 0 && (
                  <span className="flex items-center gap-1 text-blue-500">
                    <span className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin inline-block" />
                    loading row details…
                  </span>
                )}
              </p>
            </CardContent>
          </Card>
        </BlurFade>

        {/* Data Table */}
        <BlurFade delay={0.25} inView>
          <Card className="shadow-sm border-slate-100 overflow-hidden">
            <CardHeader className="pb-0 pt-4 px-5 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-blue-500" />Lead Data
              </CardTitle>
              <span className="text-xs text-slate-400">{filteredLeads.length} rows</span>
            </CardHeader>
            <CardContent className="p-0 mt-3">
              {/* Mobile card list */}
              <div className="sm:hidden divide-y divide-slate-100">
                {filteredLeads.length === 0 ? (
                  <div className="px-4 py-12 text-center text-slate-300">
                    <FileSpreadsheet className="w-8 h-8 mx-auto mb-2" /><p>No leads found</p>
                  </div>
                ) : (
                  pagedLeads.map((lead) => {
                    const d = detailsMap.get(lead.lead_id);
                    const phone = d?.phones?.[0]?.phone_number || lead.primary_visitor_phone;
                    const services = d?.services?.map((s: any) => s.service_text || s).join(', ');
                    const priorityColor = lead.priority === 'high' ? 'bg-rose-500' : lead.priority === 'medium' ? 'bg-amber-400' : 'bg-slate-300';
                    return (
                      <div
                        key={lead.lead_id}
                        onClick={() => router.push(`/leads/${lead.lead_id}`)}
                        className="flex items-start gap-3 px-4 py-3 active:bg-blue-50 cursor-pointer"
                      >
                        <div className={`w-1 self-stretch rounded-full shrink-0 ${priorityColor}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-800 truncate">{lead.company_name || '—'}</p>
                            <span className="text-[10px] text-slate-400 shrink-0">{fmtDate(lead.created_at)}</span>
                          </div>
                          <p className="text-xs text-slate-500 truncate">{lead.primary_visitor_name || '—'} {lead.primary_visitor_designation ? `· ${lead.primary_visitor_designation}` : ''}</p>
                          {phone && <p className="text-xs font-medium text-blue-600 mt-0.5">{phone}</p>}
                          {services && <p className="text-[11px] text-slate-400 truncate mt-0.5">{services}</p>}
                          {lead.exhibition_name && <p className="text-[11px] text-slate-400 truncate">{lead.exhibition_name}</p>}
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300 shrink-0 mt-1" />
                      </div>
                    );
                  })
                )}
                {/* Mobile pagination */}
                {totalPages > 1 && <PaginationBar page={page} totalPages={totalPages} total={filteredLeads.length} pageSize={PAGE_SIZE} setPage={setPage} />}
              </div>

              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="text-xs border-collapse" style={{ width: 'max-content', minWidth: '100%' }}>
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      {/* S.No sticky */}
                      <th
                        ref={el => { thRefs.current[COL_SNO] = el; }}
                        className="sticky left-0 bg-slate-50 z-10 px-3 py-3 text-center font-semibold text-slate-500 border-r border-slate-200 select-none relative"
                        style={{ width: snoWidth, minWidth: snoWidth }}
                      >
                        #
                        <span onMouseDown={(e) => startResize(COL_SNO, e)} className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400" style={{ opacity: 0.4 }} />
                      </th>
                      {/* Company Name sticky */}
                      <th
                        ref={el => { thRefs.current[COL_COMPANY] = el; }}
                        className="sticky bg-slate-50 z-10 px-3 py-3 text-left font-semibold text-slate-500 border-r border-slate-200 select-none relative"
                        style={{ left: snoWidth, width: companyWidth, minWidth: companyWidth }}
                      >
                        Company Name
                        <span onMouseDown={(e) => startResize(COL_COMPANY, e)} className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400" style={{ opacity: 0.4 }} />
                      </th>
                      {/* Client Name sticky */}
                      <th
                        ref={el => { thRefs.current[COL_PERSON] = el; }}
                        className="sticky bg-slate-50 z-10 px-3 py-3 text-left font-semibold text-slate-500 border-r border-slate-200 select-none relative"
                        style={{ left: snoWidth + companyWidth, width: personWidth, minWidth: personWidth }}
                      >
                        Client Name
                        <span onMouseDown={(e) => startResize(COL_PERSON, e)} className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400" style={{ opacity: 0.4 }} />
                      </th>
                      {/* Other columns */}
                      {([
                        { i: 3, label: 'Exhibition', w: 130 },
                        { i: 4, label: 'Services', w: 160 },
                        { i: 5, label: 'Category', w: 130 },
                        { i: 6, label: 'Vertical', w: 130 },
                        { i: 7, label: 'Turn-over', w: 110 },
                        { i: 8, label: 'Team Size', w: 100 },
                        { i: 9, label: 'Email', w: 170 },
                        { i: 10, label: 'Website', w: 140 },
                        { i: 11, label: 'Post', w: 120 },
                        { i: 12, label: 'Address', w: 180 },
                        { i: 13, label: 'State', w: 90 },
                        { i: 14, label: 'City', w: 90 },
                        { i: 15, label: 'Mobile', w: 120 },
                        { i: 16, label: 'Remark', w: 200 },
                        { i: 17, label: 'Team Member', w: 110 },
                        { i: 18, label: 'Created', w: 95 },
                      ] as { i: number; label: string; w: number }[]).map(({ i, label, w }) => (
                        <th
                          key={i}
                          ref={el => { thRefs.current[i] = el; }}
                          className="px-3 py-3 text-left font-semibold text-slate-500 relative select-none"
                          style={{ width: w, minWidth: w }}
                        >
                          {label}
                          <span onMouseDown={(e) => startResize(i, e)} className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400" style={{ opacity: 0.4 }} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLeads.length === 0 ? (
                      <tr>
                        <td colSpan={19} className="px-4 py-12 text-center text-slate-300">
                          <FileSpreadsheet className="w-8 h-8 mx-auto mb-2" /><p>No leads found</p>
                        </td>
                      </tr>
                    ) : (
                      pagedLeads.map((lead, index) => {
                        const globalIndex = (page - 1) * PAGE_SIZE + index;
                        const d = detailsMap.get(lead.lead_id);
                        const addr = d?.addresses?.[0];
                        const web = d?.websites?.[0]?.website_url;
                        const email = d?.emails?.[0]?.email_address || lead.primary_visitor_email;
                        const phone = d?.phones?.[0]?.phone_number || lead.primary_visitor_phone;
                        const services = d?.services?.map((s: any) => s.service_text || s).join(', ');
                        const lc = !d ? <span className="inline-block w-12 h-2 bg-slate-200 rounded animate-pulse" /> : null;

                        return (
                          <tr
                            key={lead.lead_id}
                            onClick={() => router.push(`/leads/${lead.lead_id}`)}
                            className="border-b border-slate-100 hover:bg-blue-50/60 cursor-pointer transition-colors group"
                          >
                            {/* S.No sticky */}
                            <td className="sticky left-0 bg-white z-10 px-3 py-2.5 text-center font-semibold text-slate-400 border-r border-slate-200 group-hover:bg-blue-50/60 transition-colors">
                              <div className="flex items-center justify-center gap-1">
                                {globalIndex + 1}
                                <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 text-blue-500 transition-opacity" />
                              </div>
                            </td>
                            {/* Company Name sticky */}
                            <td
                              className="sticky bg-white z-10 px-3 py-2.5 font-medium text-slate-800 border-r border-slate-200 group-hover:bg-blue-50/60 transition-colors"
                              style={{ left: snoWidth }}
                            >
                              <span className="block truncate" style={{ maxWidth: companyWidth - 24 }} title={lead.company_name ?? undefined}>{fmt(lead.company_name)}</span>
                            </td>
                            {/* Client Name sticky */}
                            <td
                              className="sticky bg-white z-10 px-3 py-2.5 font-medium text-slate-700 border-r border-slate-200 group-hover:bg-blue-50/60 transition-colors"
                              style={{ left: snoWidth + companyWidth }}
                            >
                              <span className="block truncate" style={{ maxWidth: personWidth - 24 }} title={lead.primary_visitor_name ?? undefined}>{fmt(lead.primary_visitor_name)}</span>
                            </td>
                            <td className="px-3 py-2.5 text-slate-600"><span className="block truncate" style={{ maxWidth: 130 }} title={lead.exhibition_name ?? undefined}>{fmt(lead.exhibition_name)}</span></td>
                            <td className="px-3 py-2.5 text-slate-600">{!d ? lc : services ? <span className="block truncate" style={{ maxWidth: 160 }} title={services}>{services}</span> : <span className="text-slate-300">—</span>}</td>

                            {/* Category — editable */}
                            <td className="px-3 py-2.5 text-slate-600" onClick={e => startEdit(e, lead.lead_id, 'category', lead.category || '')}>
                              {editingCell?.leadId === lead.lead_id && editingCell.field === 'category' ? (
                                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                  <input
                                    autoFocus
                                    list="category-options"
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(lead.lead_id, lead); if (e.key === 'Escape') setEditingCell(null); }}
                                    onBlur={() => saveEdit(lead.lead_id, lead)}
                                    className="w-24 text-xs border border-blue-400 rounded px-1.5 py-0.5 outline-none"
                                  />
                                  <datalist id="category-options">
                                    {allCategories.map(c => <option key={c} value={c} />)}
                                    {['Supplier', 'Printer', 'Distributor', 'Manufacturer', 'Agency'].map(c => <option key={c} value={c} />)}
                                  </datalist>
                                </div>
                              ) : (
                                <span className="block truncate cursor-pointer hover:text-blue-600" style={{ maxWidth: 120 }} title={lead.category ?? undefined}>
                                  {lead.category || <span className="text-slate-300 italic text-[11px]">click to add</span>}
                                </span>
                              )}
                            </td>

                            {/* Vertical — editable dropdown */}
                            <td className="px-3 py-2.5 text-slate-600" onClick={e => startEdit(e, lead.lead_id, 'vertical', lead.vertical || '')}>
                              {editingCell?.leadId === lead.lead_id && editingCell.field === 'vertical' ? (
                                <div onClick={e => e.stopPropagation()}>
                                  <select
                                    autoFocus
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onBlur={() => saveEdit(lead.lead_id, lead)}
                                    onKeyDown={e => { if (e.key === 'Escape') setEditingCell(null); }}
                                    className="text-xs border border-blue-400 rounded px-1 py-0.5 outline-none w-28"
                                  >
                                    <option value="">— None —</option>
                                    {VERTICAL_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
                                  </select>
                                </div>
                              ) : (
                                <span className="block truncate cursor-pointer hover:text-blue-600" style={{ maxWidth: 120 }} title={lead.vertical ?? undefined}>
                                  {lead.vertical || <span className="text-slate-300 italic text-[11px]">click to add</span>}
                                </span>
                              )}
                            </td>

                            {/* Turn-over — editable */}
                            <td className="px-3 py-2.5 text-slate-600" onClick={e => startEdit(e, lead.lead_id, 'turn_over', lead.turn_over || '')}>
                              {editingCell?.leadId === lead.lead_id && editingCell.field === 'turn_over' ? (
                                <div onClick={e => e.stopPropagation()}>
                                  <input
                                    autoFocus
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(lead.lead_id, lead); if (e.key === 'Escape') setEditingCell(null); }}
                                    onBlur={() => saveEdit(lead.lead_id, lead)}
                                    placeholder="e.g. 5 Cr"
                                    className="w-20 text-xs border border-blue-400 rounded px-1.5 py-0.5 outline-none"
                                  />
                                </div>
                              ) : (
                                <span className="block truncate cursor-pointer hover:text-blue-600" style={{ maxWidth: 100 }}>
                                  {lead.turn_over || <span className="text-slate-300 italic text-[11px]">click to add</span>}
                                </span>
                              )}
                            </td>

                            {/* Team Size — editable */}
                            <td className="px-3 py-2.5 text-slate-600" onClick={e => startEdit(e, lead.lead_id, 'team_size', lead.team_size || '')}>
                              {editingCell?.leadId === lead.lead_id && editingCell.field === 'team_size' ? (
                                <div onClick={e => e.stopPropagation()}>
                                  <input
                                    autoFocus
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(lead.lead_id, lead); if (e.key === 'Escape') setEditingCell(null); }}
                                    onBlur={() => saveEdit(lead.lead_id, lead)}
                                    placeholder="e.g. 50-100"
                                    className="w-20 text-xs border border-blue-400 rounded px-1.5 py-0.5 outline-none"
                                  />
                                </div>
                              ) : (
                                <span className="block truncate cursor-pointer hover:text-blue-600" style={{ maxWidth: 90 }}>
                                  {lead.team_size || <span className="text-slate-300 italic text-[11px]">click to add</span>}
                                </span>
                              )}
                            </td>

                            <td className="px-3 py-2.5 text-slate-600">{!d ? lc : <span className="block truncate" style={{ maxWidth: 170 }} title={email ?? undefined}>{fmt(email)}</span>}</td>
                            <td className="px-3 py-2.5 text-slate-600">
                              {!d ? lc : web ? (
                                <a href={web.startsWith('http') ? web : `https://${web}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="block truncate text-blue-600 hover:underline" style={{ maxWidth: 140 }} title={web}>{web}</a>
                              ) : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-slate-600"><span className="block truncate" style={{ maxWidth: 120 }}>{fmt(lead.primary_visitor_designation)}</span></td>
                            <td className="px-3 py-2.5 text-slate-600">{!d ? lc : <span className="block truncate" style={{ maxWidth: 180 }} title={addr?.address_text ?? undefined}>{fmt(addr?.address_text)}</span>}</td>
                            <td className="px-3 py-2.5 text-slate-600">{!d ? lc : fmt(addr?.state)}</td>
                            <td className="px-3 py-2.5 text-slate-600">{!d ? lc : fmt(addr?.city)}</td>
                            <td className="px-3 py-2.5 font-medium text-blue-600 whitespace-nowrap">{fmt(phone)}</td>
                            <td className="px-3 py-2.5 text-slate-600"><span className="block truncate" style={{ maxWidth: 200 }} title={lead.discussion_summary ?? undefined}>{fmt(lead.discussion_summary)}</span></td>
                            <td className="px-3 py-2.5 text-slate-600"><span className="block truncate" style={{ maxWidth: 110 }}>{fmt(lead.assigned_employee_name)}</span></td>
                            <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{fmtDate(lead.created_at)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Desktop pagination */}
              {totalPages > 1 && (
                <div className="hidden sm:block px-5 py-3 border-t border-slate-100">
                  <PaginationBar page={page} totalPages={totalPages} total={filteredLeads.length} pageSize={PAGE_SIZE} setPage={setPage} />
                </div>
              )}
            </CardContent>
          </Card>
        </BlurFade>

        <div className="md:hidden h-16" />
      </div>

      {/* Services dropdown — fixed so it escapes all overflow/z-index clipping */}
      {showServicesDropdown && (
        <div
          ref={servicesDropdownRef}
          style={{ position: 'fixed', top: svcDropPos.top, left: svcDropPos.left, width: svcDropPos.width, zIndex: 9999 }}
          className="max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-2xl"
        >
          {servicesSuggestions.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-400 italic">No services found</p>
          ) : (
            <>
              {filterServices.length > 0 && (
                <div className="px-3 py-1.5 border-b border-slate-100 sticky top-0 bg-white">
                  <button onClick={() => setFilterServices([])} className="text-[11px] text-blue-600 hover:text-blue-800 font-medium">
                    Clear ({filterServices.length} selected)
                  </button>
                </div>
              )}
              {servicesSuggestions.map(s => (
                <label key={s} className="flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 cursor-pointer text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={filterServices.includes(s)}
                    onChange={e => setFilterServices(prev => e.target.checked ? [...prev, s] : prev.filter(x => x !== s))}
                    className="rounded accent-blue-600"
                  />
                  <span className="truncate">{s}</span>
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PaginationBar({ page, totalPages, total, pageSize, setPage }: {
  page: number; totalPages: number; total: number; pageSize: number; setPage: (p: number) => void;
}) {
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
    .reduce<(number | '...')[]>((acc, p, idx, arr) => {
      if (idx > 0 && typeof arr[idx - 1] === 'number' && (p as number) - (arr[idx - 1] as number) > 1) acc.push('...');
      acc.push(p);
      return acc;
    }, []);

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <p className="text-xs text-slate-400">
        Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </p>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setPage(Math.max(1, page - 1))}
          disabled={page === 1}
          className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`e${i}`} className="text-xs text-slate-400 px-1">…</span>
          ) : (
            <button
              key={p}
              onClick={() => setPage(p as number)}
              className={`min-w-[30px] h-7 rounded-lg text-xs font-semibold transition ${page === p ? 'bg-blue-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-100'}`}
            >
              {p}
            </button>
          )
        )}
        <button
          onClick={() => setPage(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
