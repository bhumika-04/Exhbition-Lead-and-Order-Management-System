'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { isAuthenticated, getEmployee, hasPermission } from '@/lib/auth';
import type { Lead } from '@/lib/types';
import {
  Search, Plus, Building2, User, Phone, Trash2,
  AlertTriangle, X, SlidersHorizontal, ChevronRight, Loader2,
  Users, Download, CheckCircle2, Upload, ChevronLeft,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AnimatedList, AnimatedListItem } from '@/components/ui/animated-list';
import { cn } from '@/lib/utils';

const AVATAR_COLORS = [
  { bg: 'bg-blue-100',   text: 'text-blue-600'   },
  { bg: 'bg-violet-100', text: 'text-violet-600'  },
  { bg: 'bg-emerald-100',text: 'text-emerald-600' },
  { bg: 'bg-amber-100',  text: 'text-amber-600'   },
  { bg: 'bg-rose-100',   text: 'text-rose-600'    },
  { bg: 'bg-cyan-100',   text: 'text-cyan-600'    },
  { bg: 'bg-indigo-100', text: 'text-indigo-600'  },
  { bg: 'bg-orange-100', text: 'text-orange-600'  },
];

const PRIORITY_BAR: Record<string, string> = {
  high: 'bg-red-400',
  medium: 'bg-amber-400',
  low: 'bg-emerald-400',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  confirmed: 'default',
  new: 'secondary',
  needs_correction: 'destructive',
  in_progress: 'outline',
};

// Pull the first number out of a free-text value, e.g. "10 Cr" -> 10, "80 employees" -> 80
const parseLeadingNumber = (s?: string | null): number | null => {
  if (!s) return null;
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

export default function LeadsPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [filteredLeads, setFilteredLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [exhibitionFilter, setExhibitionFilter] = useState('all');
  const [segmentFilter, setSegmentFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [cityFilter, setCityFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [serviceFilter, setServiceFilter] = useState<string[]>([]);
  const [svcSearch, setSvcSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [verticalFilter, setVerticalFilter] = useState('all');
  const [turnoverMin, setTurnoverMin] = useState('');
  const [turnoverMax, setTurnoverMax] = useState('');
  const [teamMin, setTeamMin] = useState('');
  const [teamMax, setTeamMax] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState('date_desc');
  const [showFilters, setShowFilters] = useState(false);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const savedPageRef = useRef<number | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [exhibitions, setExhibitions] = useState<any[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 21;

  useEffect(() => {
    setMounted(true);
    // Restore pagination position when coming back from lead detail
    const saved = sessionStorage.getItem('leads_page');
    if (saved) {
      sessionStorage.removeItem('leads_page');
      savedPageRef.current = parseInt(saved, 10);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated()) { router.push('/auth/login'); return; }
    if (!hasPermission('view_leads')) { router.replace('/access-denied?from=/leads'); return; }
    loadLeads();
    loadExhibitions();
  }, [mounted, router]);

  useEffect(() => {
    applyFilters();
  }, [leads, searchQuery, statusFilter, sourceFilter, exhibitionFilter, segmentFilter, priorityFilter, cityFilter, stateFilter, serviceFilter, categoryFilter, verticalFilter, turnoverMin, turnoverMax, teamMin, teamMax, dateFrom, dateTo, sortBy]);

  const loadExhibitions = async () => {
    try { setExhibitions(await api.getExhibitions()); } catch { /* silent */ }
  };

  const loadLeads = async (service?: string) => {
    try {
      const { leads: data } = await api.getLeads({
        limit: 5000,
        service: service || undefined,
      });
      setLeads(data);
    } catch { console.error('Failed to load leads'); }
    finally { setLoading(false); }
  };

  const applyFilters = () => {
    let f = [...leads];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      f = f.filter(l => {
        const displayName = (l.primary_visitor_name || 'unknown visitor').toLowerCase();
        return (
          displayName.includes(q) ||
          l.company_name?.toLowerCase().includes(q) ||
          l.primary_visitor_phone?.includes(q) ||
          l.primary_visitor_email?.toLowerCase().includes(q)
        );
      });
    }
    if (statusFilter !== 'all') f = f.filter(l => l.status_code === statusFilter);
    if (sourceFilter !== 'all') f = f.filter(l => l.source_code === sourceFilter);
    if (exhibitionFilter !== 'all') f = f.filter(l => l.exhibition_id?.toString() === exhibitionFilter);
    if (segmentFilter !== 'all') f = f.filter(l => l.segment === segmentFilter);
    if (priorityFilter !== 'all') f = f.filter(l => l.priority === priorityFilter);
    if (cityFilter !== 'all') f = f.filter(l => l.city?.toLowerCase() === cityFilter.toLowerCase());
    if (stateFilter !== 'all') f = f.filter(l => l.state?.toLowerCase() === stateFilter.toLowerCase());
    if (serviceFilter.length > 0) {
      f = f.filter(l => {
        try {
          const svcs: any[] = JSON.parse(l.services_json || '[]');
          const texts = svcs.map(s => (s.service_text || s || '').toLowerCase());
          return serviceFilter.some(sel => texts.some(t => t.includes(sel.toLowerCase())));
        } catch { return false; }
      });
    }
    if (categoryFilter !== 'all') f = f.filter(l => l.category === categoryFilter);
    if (verticalFilter !== 'all') f = f.filter(l => l.vertical === verticalFilter);
    // Turn-over / Team-size are free text — parse the leading number and match the Min/Max range
    if (turnoverMin || turnoverMax) {
      const min = turnoverMin ? parseFloat(turnoverMin) : -Infinity;
      const max = turnoverMax ? parseFloat(turnoverMax) : Infinity;
      f = f.filter(l => { const n = parseLeadingNumber(l.turn_over); return n !== null && n >= min && n <= max; });
    }
    if (teamMin || teamMax) {
      const min = teamMin ? parseFloat(teamMin) : -Infinity;
      const max = teamMax ? parseFloat(teamMax) : Infinity;
      f = f.filter(l => { const n = parseLeadingNumber(l.team_size); return n !== null && n >= min && n <= max; });
    }
    if (dateFrom) { const d = new Date(dateFrom); d.setHours(0,0,0,0); f = f.filter(l => new Date(l.created_at) >= d); }
    if (dateTo)   { const d = new Date(dateTo);   d.setHours(23,59,59,999); f = f.filter(l => new Date(l.created_at) <= d); }
    f.sort((a, b) => {
      switch (sortBy) {
        case 'date_asc':     return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'name_asc':     return (a.primary_visitor_name||'').localeCompare(b.primary_visitor_name||'');
        case 'name_desc':    return (b.primary_visitor_name||'').localeCompare(a.primary_visitor_name||'');
        case 'company_asc':  return (a.company_name||'').localeCompare(b.company_name||'');
        case 'company_desc': return (b.company_name||'').localeCompare(a.company_name||'');
        case 'priority': {
          const o: Record<string,number> = { high:3, medium:2, low:1 };
          return (o[b.priority||'']||0) - (o[a.priority||'']||0);
        }
        default: return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });
    setFilteredLeads(f);
    // Restore saved page (from back navigation) once leads have loaded; otherwise reset to 1.
    // Guard on leads.length so the initial empty-array pass doesn't consume the saved page.
    if (savedPageRef.current !== null) {
      if (leads.length > 0) {
        setPage(savedPageRef.current);
        savedPageRef.current = null;
      }
    } else {
      setPage(1);
    }
  };

  const clearAllFilters = () => {
    setSearchQuery(''); setStatusFilter('all'); setSourceFilter('all');
    setExhibitionFilter('all'); setSegmentFilter('all'); setPriorityFilter('all');
    setCityFilter('all'); setStateFilter('all'); setServiceFilter([]);
    setCategoryFilter('all'); setVerticalFilter('all');
    setTurnoverMin(''); setTurnoverMax(''); setTeamMin(''); setTeamMax('');
    setDateFrom(''); setDateTo(''); setSortBy('date_desc');
    loadLeads();
  };

  const activeFilterCount = [
    statusFilter !== 'all', sourceFilter !== 'all', exhibitionFilter !== 'all',
    segmentFilter !== 'all', priorityFilter !== 'all', cityFilter !== 'all', stateFilter !== 'all',
    serviceFilter.length > 0, categoryFilter !== 'all', verticalFilter !== 'all',
    !!(turnoverMin || turnoverMax), !!(teamMin || teamMax),
    !!dateFrom, !!dateTo, sortBy !== 'date_desc',
  ].filter(Boolean).length;

  const handleDeleteLead = async (leadId: number) => {
    try {
      await api.deleteLead(leadId);
      await loadLeads();
      setShowDeleteConfirm(false);
      setSelectedLead(null);
      toast.success('Lead deleted');
    } catch { toast.error('Failed to delete lead'); }
  };

  const confirmDelete = (lead: Lead) => { setSelectedLead(lead); setShowDeleteConfirm(true); };

  const toggleSelectMode = () => {
    setSelectMode(v => !v);
    setSelectedLeads(new Set());
  };

  const toggleLeadSelection = (leadId: number) => {
    setSelectedLeads(prev => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedLeads(new Set(filteredLeads.map(l => l.lead_id)));
  };

  const saveContacts = () => {
    const selected = filteredLeads.filter(l => selectedLeads.has(l.lead_id));
    if (selected.length === 0) { toast.error('Select at least one contact'); return; }

    const vcf = selected.map(lead => {
      const name = (lead.primary_visitor_name || '').trim();
      const parts = name.split(' ');
      const firstName = parts[0] || '';
      const lastName = parts.slice(1).join(' ');
      const lines = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${name || lead.company_name || 'Unknown'}`,
        `N:${lastName};${firstName};;;`,
      ];
      if (lead.company_name) lines.push(`ORG:${lead.company_name}`);
      if (lead.primary_visitor_designation) lines.push(`TITLE:${lead.primary_visitor_designation}`);
      if (lead.primary_visitor_phone) lines.push(`TEL;TYPE=CELL:${lead.primary_visitor_phone}`);
      if (lead.primary_visitor_email) lines.push(`EMAIL:${lead.primary_visitor_email}`);
      lines.push('END:VCARD');
      return lines.join('\r\n');
    }).join('\r\n');

    const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads-contacts-${selected.length}.vcf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success(`${selected.length} contact${selected.length > 1 ? 's' : ''} exported`);
    setSelectMode(false);
    setSelectedLeads(new Set());
  };

  const handleCreateLead = async (formData: any) => {
    try {
      const employee = getEmployee();
      await api.createLead({ ...formData, assigned_employee_id: employee?.employee_id });
      toast.success('Lead created!');
      setShowCreateForm(false);
      await loadLeads();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to create lead');
    }
  };

  if (!mounted) return null;

  if (loading) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden bg-slate-50">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            <p className="text-sm text-slate-500 font-medium">Loading leads…</p>
          </div>
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(filteredLeads.length / PAGE_SIZE);
  const pagedLeads = filteredLeads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-slate-50">

      {/* ── Header ── */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200 px-4 md:px-6 py-4 md:py-0 shrink-0 md:min-h-[65px] flex items-center">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-slate-900">Leads</h1>
            <span className="bg-blue-100 text-blue-700 text-xs font-bold rounded-full px-2 py-0.5">
              {filteredLeads.length}
            </span>
          </div>
          <p className="text-[11px] text-slate-400">Exhibition visitors &amp; card scans</p>
        </div>
      </div>

      {/* ── Toolbar: Search + Filter + Select + Add ── */}
      {!selectMode ? (
        <div className="bg-white border-b border-slate-100 px-4 md:px-6 py-2.5 shrink-0 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search name, company, phone…"
              className="pl-9 h-9 bg-slate-50 border-slate-200 focus:bg-white text-sm"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Button
            ref={filterBtnRef}
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className={cn('gap-1.5 h-9 text-xs px-3 shrink-0', showFilters && 'bg-blue-50 border-blue-300 text-blue-700')}
          >
            <SlidersHorizontal className="w-3 h-3" />
            Filters
            {activeFilterCount > 0 && (
              <span className="bg-blue-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleSelectMode}
            className="gap-1.5 h-9 text-xs px-3 shrink-0"
            title="Select contacts to export as .vcf"
          >
            <Users className="w-3 h-3" />
            <span className="hidden sm:inline">Select</span>
          </Button>
          <Button size="sm" onClick={() => setShowCreateForm(true)} className="gap-1.5 h-9 text-xs px-3 shrink-0">
            <Plus className="w-3 h-3" /> Add
          </Button>
        </div>
      ) : (
        /* ── Select Mode Toolbar ── */
        <div className="bg-blue-50 border-b border-blue-200 px-4 md:px-6 py-2.5 shrink-0 flex items-center gap-2">
          <span className="text-sm font-semibold text-blue-800 flex-1">
            {`${selectedLeads.size} of ${filteredLeads.length} selected`}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={selectAllFiltered}
            className="gap-1.5 h-9 text-xs px-3 shrink-0 border-blue-300 text-blue-700 hover:bg-blue-100"
          >
            All
          </Button>
          <Button
            size="sm"
            onClick={saveContacts}
            disabled={selectedLeads.size === 0}
            className="gap-1.5 h-9 text-xs px-3 shrink-0 bg-blue-600 hover:bg-blue-700"
          >
            <Download className="w-3 h-3" />
            Contacts{selectedLeads.size > 0 ? ` (${selectedLeads.size})` : ''}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSelectMode}
            className="gap-1 h-9 text-xs px-2.5 shrink-0 text-slate-600"
          >
            <X className="w-3.5 h-3.5" /> Cancel
          </Button>
        </div>
      )}

      {/* ── Filter Overlay ── */}
      <AnimatePresence>
        {showFilters && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setShowFilters(false)} />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="fixed right-4 md:right-6 z-40 w-[520px] max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-2xl shadow-2xl shadow-slate-200/80 overflow-hidden flex flex-col"
              style={{ top: (filterBtnRef.current?.getBoundingClientRect().bottom ?? 120) + 8 }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <span className="text-sm font-semibold text-slate-800">Filters</span>
                <button onClick={() => setShowFilters(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {(() => {
                // Cascading city/state logic
                const allStates = Array.from(new Set(leads.map(l => l.state).filter(Boolean) as string[])).sort();
                const citiesForState = stateFilter !== 'all'
                  ? Array.from(new Set(leads.filter(l => l.state?.toLowerCase() === stateFilter.toLowerCase()).map(l => l.city).filter(Boolean) as string[])).sort()
                  : Array.from(new Set(leads.map(l => l.city).filter(Boolean) as string[])).sort();

                const handleCityChange = (city: string) => {
                  setCityFilter(city);
                  if (city !== 'all' && stateFilter === 'all') {
                    const match = leads.find(l => l.city?.toLowerCase() === city.toLowerCase());
                    if (match?.state) setStateFilter(match.state);
                  }
                };
                const handleStateChange = (state: string) => {
                  setStateFilter(state);
                  setCityFilter('all');
                };

                // All unique services parsed from lead data
                const allServices = Array.from(new Set(
                  leads.flatMap(l => {
                    try { return (JSON.parse(l.services_json || '[]') as any[]).map((s: any) => s.service_text || s).filter(Boolean); }
                    catch { return []; }
                  })
                )).sort();

                const visibleServices = svcSearch.trim()
                  ? allServices.filter(s => s.toLowerCase().includes(svcSearch.toLowerCase()))
                  : allServices;

                const allCategories = Array.from(new Set(leads.map(l => l.category).filter(Boolean) as string[])).sort();
                const allVerticals = Array.from(new Set(leads.map(l => l.vertical).filter(Boolean) as string[])).sort();

                const FilterRow = ({ label, value, onChange, options }: {
                  label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[];
                }) => (
                  <div className="flex items-center gap-3 py-2.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest w-20 shrink-0">{label}</span>
                    <Select value={value} onValueChange={onChange}>
                      <SelectTrigger className={cn('h-8 text-xs border-slate-200 flex-1', value !== 'all' && value !== 'date_desc' && 'border-blue-300 bg-blue-50 text-blue-700')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map(o => <SelectItem key={o.v} value={o.v} className="text-xs">{o.l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                );

                return (
                  <div className="px-4 pt-2 pb-4 divide-y divide-slate-100 overflow-y-auto max-h-[calc(100vh-14rem)]">

                    <FilterRow label="Status" value={statusFilter} onChange={setStatusFilter} options={[
                      { v: 'all', l: 'All Statuses' }, { v: 'new', l: 'New' },
                      { v: 'confirmed', l: 'Confirmed' }, { v: 'needs_correction', l: 'Needs Correction' },
                      { v: 'in_progress', l: 'In Progress' },
                    ]} />

                    <FilterRow label="Priority" value={priorityFilter} onChange={setPriorityFilter} options={[
                      { v: 'all', l: 'All Priorities' }, { v: 'high', l: 'High' },
                      { v: 'medium', l: 'Medium' }, { v: 'low', l: 'Low' },
                    ]} />

                    <FilterRow label="Source" value={sourceFilter} onChange={setSourceFilter} options={[
                      { v: 'all', l: 'All Sources' }, { v: 'employee', l: 'Employee' }, { v: 'qr', l: 'QR Code' },
                    ]} />

                    {/* State — clears city on change */}
                    <FilterRow label="State" value={stateFilter} onChange={handleStateChange}
                      options={[{ v: 'all', l: 'All States' }, ...allStates.map(s => ({ v: s, l: s }))]} />

                    {/* City — auto-fills state, filtered by selected state */}
                    <FilterRow label="City" value={cityFilter} onChange={handleCityChange}
                      options={[{ v: 'all', l: 'All Cities' }, ...citiesForState.map(c => ({ v: c, l: c }))]} />

                    {/* Services — multi-select with search */}
                    <div className="py-2.5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Services</span>
                        <div className="flex items-center gap-2">
                          {serviceFilter.length > 0 && (
                            <button onClick={() => setServiceFilter([])} className="text-[11px] text-blue-600 hover:text-blue-800 font-medium">Clear</button>
                          )}
                          <span className="text-[11px] text-slate-400">{serviceFilter.length > 0 ? `${serviceFilter.length} selected` : 'All'}</span>
                        </div>
                      </div>
                      {allServices.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">No services available</p>
                      ) : (
                        <>
                          <input
                            type="text"
                            value={svcSearch}
                            onChange={e => setSvcSearch(e.target.value)}
                            placeholder="Search services…"
                            className="w-full mb-1.5 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white"
                          />
                          <div className="max-h-36 overflow-y-auto space-y-0.5 border border-slate-100 rounded-lg p-1.5 bg-slate-50">
                            {visibleServices.length === 0 && (
                              <p className="text-xs text-slate-400 italic px-2 py-1">No match</p>
                            )}
                            {visibleServices.map(s => (
                              <label key={s} className="flex items-center gap-2 px-2 py-1 hover:bg-white rounded-md cursor-pointer text-xs text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={serviceFilter.includes(s)}
                                  onChange={e => setServiceFilter(prev => e.target.checked ? [...prev, s] : prev.filter(x => x !== s))}
                                  className="rounded accent-blue-600 shrink-0"
                                />
                                <span className="truncate">{s}</span>
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    <FilterRow label="Category" value={categoryFilter} onChange={setCategoryFilter}
                      options={[{ v: 'all', l: 'All Categories' }, ...allCategories.map(c => ({ v: c, l: c }))]} />

                    <FilterRow label="Vertical" value={verticalFilter} onChange={setVerticalFilter}
                      options={[{ v: 'all', l: 'All Verticals' }, ...allVerticals.map(v => ({ v: v, l: v }))]} />

                    {/* Turnover range (Cr) */}
                    <div className="flex items-center gap-3 py-2.5">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest w-20 shrink-0">Turnover</span>
                      <div className="flex items-center gap-1.5 flex-1">
                        <input type="number" inputMode="decimal" value={turnoverMin} onChange={e => setTurnoverMin(e.target.value)}
                          placeholder="Min Cr"
                          className="w-full h-8 px-2.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white" />
                        <span className="text-slate-300 text-xs">–</span>
                        <input type="number" inputMode="decimal" value={turnoverMax} onChange={e => setTurnoverMax(e.target.value)}
                          placeholder="Max Cr"
                          className="w-full h-8 px-2.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white" />
                      </div>
                    </div>

                    {/* Team size range (employees) */}
                    <div className="flex items-center gap-3 py-2.5">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest w-20 shrink-0">Team Size</span>
                      <div className="flex items-center gap-1.5 flex-1">
                        <input type="number" inputMode="numeric" value={teamMin} onChange={e => setTeamMin(e.target.value)}
                          placeholder="Min"
                          className="w-full h-8 px-2.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white" />
                        <span className="text-slate-300 text-xs">–</span>
                        <input type="number" inputMode="numeric" value={teamMax} onChange={e => setTeamMax(e.target.value)}
                          placeholder="Max"
                          className="w-full h-8 px-2.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white" />
                      </div>
                    </div>

                    <FilterRow label="Sort By" value={sortBy} onChange={setSortBy} options={[
                      { v: 'date_desc', l: 'Newest First' }, { v: 'date_asc', l: 'Oldest First' },
                      { v: 'name_asc', l: 'Name A-Z' }, { v: 'priority', l: 'By Priority' },
                    ]} />

                    {activeFilterCount > 0 && (
                      <div className="pt-3">
                        <button onClick={() => { clearAllFilters(); setShowFilters(false); }} className="text-[11px] text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1">
                          <X className="w-3 h-3" /> Clear all filters
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Lead Cards ── */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        {filteredLeads.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20"
          >
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
              <User className="w-8 h-8 text-slate-300" />
            </div>
            <p className="font-semibold text-slate-700 mb-1">No leads found</p>
            <p className="text-sm text-slate-400 mb-5">
              {searchQuery || activeFilterCount > 0 ? 'Try adjusting your filters' : 'Start by scanning a visiting card'}
            </p>
            <Button onClick={() => router.push('/chat')} size="sm">Scan a Card</Button>
          </motion.div>
        ) : (
          <>
          <AnimatedList className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
            {pagedLeads.map((lead) => {
              const initials = (lead.primary_visitor_name || lead.company_name || '?')
                .split(' ').slice(0, 2).map((w: string) => w[0] || '').join('').toUpperCase();
              const avatar = AVATAR_COLORS[lead.lead_id % AVATAR_COLORS.length];
              const priorityBar = PRIORITY_BAR[lead.priority || ''] || 'bg-slate-200';
              const statusVariant = STATUS_VARIANT[lead.status_code] || 'secondary';

              const isSelected = selectedLeads.has(lead.lead_id);

              return (
                <AnimatedListItem key={lead.lead_id}>
                  <motion.div
                    onClick={() => {
                      if (selectMode) { toggleLeadSelection(lead.lead_id); return; }
                      sessionStorage.setItem('leads_page', page.toString());
                      router.push(`/leads/${lead.lead_id}`);
                    }}
                    whileHover={{ y: -3, boxShadow: '0 12px 40px -8px rgba(0,0,0,0.15)' }}
                    transition={{ duration: 0.15 }}
                    className={cn(
                      'bg-white rounded-2xl border shadow-sm cursor-pointer group relative overflow-hidden transition-colors',
                      isSelected ? 'border-blue-400 ring-2 ring-blue-200' : 'border-slate-100',
                    )}
                  >
                    {/* Priority accent bar */}
                    <div className={cn('absolute left-0 top-0 bottom-0 w-[3px]', priorityBar)} />

                    <div className="pl-4 pr-4 pt-3.5 pb-3.5">
                      {/* Select mode checkbox / Delete on hover */}
                      {selectMode ? (
                        <div className="absolute top-2.5 right-2.5 pointer-events-none">
                          {isSelected
                            ? <CheckCircle2 className="w-5 h-5 text-blue-500" />
                            : <div className="w-5 h-5 rounded-full border-2 border-slate-300 bg-white" />
                          }
                        </div>
                      ) : (
                        <button
                          onClick={e => { e.stopPropagation(); confirmDelete(lead); }}
                          className="absolute top-2.5 right-2.5 p-1.5 rounded-lg text-slate-200 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all duration-150"
                          title="Delete lead"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <div className="flex items-start gap-3">
                        {/* Avatar */}
                        <div className={cn(
                          'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bold text-sm',
                          avatar.bg, avatar.text
                        )}>
                          {initials || '?'}
                        </div>

                        <div className="flex-1 min-w-0 pr-5">
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {lead.primary_visitor_name || 'Unknown Visitor'}
                          </p>
                          {lead.primary_visitor_designation && (
                            <p className="text-[11px] text-slate-400 truncate">{lead.primary_visitor_designation}</p>
                          )}
                          {lead.company_name && (
                            <p className="text-xs text-slate-500 flex items-center gap-1 mt-1 truncate">
                              <Building2 className="w-3 h-3 shrink-0 text-slate-300" />
                              {lead.company_name}
                            </p>
                          )}
                          {lead.primary_visitor_phone && (
                            <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                              <Phone className="w-3 h-3 shrink-0 text-slate-300" />
                              {lead.primary_visitor_phone}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Classification chips */}
                      {(lead.category || lead.vertical || lead.turn_over || lead.team_size) && (
                        <div className="flex flex-wrap gap-1.5 mt-2.5">
                          {lead.category && (
                            <span className="text-[10px] font-medium bg-violet-50 text-violet-600 rounded-md px-1.5 py-0.5 max-w-[140px] truncate" title={`Category: ${lead.category}`}>{lead.category}</span>
                          )}
                          {lead.vertical && (
                            <span className="text-[10px] font-medium bg-sky-50 text-sky-600 rounded-md px-1.5 py-0.5 max-w-[140px] truncate" title={`Vertical: ${lead.vertical}`}>{lead.vertical}</span>
                          )}
                          {lead.turn_over && (
                            <span className="text-[10px] font-medium bg-emerald-50 text-emerald-600 rounded-md px-1.5 py-0.5" title={`Turnover: ${lead.turn_over}`}>₹{lead.turn_over}</span>
                          )}
                          {lead.team_size && (
                            <span className="text-[10px] font-medium bg-amber-50 text-amber-600 rounded-md px-1.5 py-0.5" title={`Team size: ${lead.team_size}`}>{lead.team_size} emp</span>
                          )}
                        </div>
                      )}

                      {/* Card footer */}
                      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-50">
                        <div className="flex items-center gap-1.5">
                          <Badge variant={statusVariant} className="text-[11px] h-5 py-0 px-2">
                            {lead.status_name || lead.status_code || 'pending'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                          {lead.priority === 'high' && <span className="text-red-400 font-semibold">● High</span>}
                          <span suppressHydrationWarning>
                            {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-200 group-hover:text-blue-400 transition-colors" />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </AnimatedListItem>
              );
            })}
          </AnimatedList>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-5 px-1">
              <p className="text-xs text-slate-400">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredLeads.length)} of {filteredLeads.length}
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                  .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                    if (idx > 0 && typeof arr[idx - 1] === 'number' && (p as number) - (arr[idx - 1] as number) > 1) acc.push('...');
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, i) =>
                    p === '...' ? (
                      <span key={`ellipsis-${i}`} className="text-xs text-slate-400 px-1">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setPage(p as number)}
                        className={cn(
                          'min-w-[30px] h-7 rounded-lg text-xs font-semibold transition',
                          page === p ? 'bg-blue-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-100'
                        )}
                      >
                        {p}
                      </button>
                    )
                  )}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
          </>
        )}
        <div className="md:hidden h-20" />
      </div>

      {/* ── Create Modal ── */}
      {showCreateForm && (
        <ManualLeadForm exhibitions={exhibitions} onClose={() => setShowCreateForm(false)} onSubmit={handleCreateLead} />
      )}

      {/* ── Delete Confirm ── */}
      <AnimatePresence>
        {showDeleteConfirm && selectedLead && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 bg-red-100 rounded-xl flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Delete Lead?</h3>
                  <p className="text-xs text-slate-500">Data is soft-deleted and can be restored</p>
                </div>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 mb-5 border border-slate-100">
                <p className="text-sm font-semibold text-slate-800">{selectedLead.primary_visitor_name}</p>
                <p className="text-xs text-slate-500">{selectedLead.company_name}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { setShowDeleteConfirm(false); setSelectedLead(null); }}>
                  Cancel
                </Button>
                <Button variant="destructive" className="flex-1" onClick={() => handleDeleteLead(selectedLead.lead_id)}>
                  Delete
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────
// Manual Lead Creation Form
// ─────────────────────────────────────────
function ManualLeadForm({ exhibitions, onClose, onSubmit }: {
  exhibitions: any[];
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
}) {
  const [formData, setFormData] = useState({
    exhibition_id: exhibitions.find(e => e.is_active)?.exhibition_id || 1,
    source_code: 'manual_entry',
    company_name: '',
    primary_visitor_name: '',
    primary_visitor_designation: '',
    primary_visitor_phone: '',
    primary_visitor_email: '',
    discussion_summary: '',
    next_step: '',
    segment: 'general',
    priority: 'medium',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = (field: string, value: string) => setFormData(p => ({ ...p, [field]: value }));

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setIsSubmitting(true);
    try { await onSubmit({ ...formData, exhibition_id: parseInt(formData.exhibition_id.toString()) }); }
    finally { setIsSubmitting(false); }
  };

  const cls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white';

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto"
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full my-8"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900">Add Lead Manually</h2>
            <p className="text-xs text-slate-400">Enter visitor details</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-3.5 max-h-[65vh] overflow-y-auto">
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 block">Exhibition <span className="text-red-400">*</span></label>
            <select value={formData.exhibition_id} onChange={e => set('exhibition_id', e.target.value)} className={cls} required>
              {exhibitions.map(exh => (
                <option key={exh.exhibition_id} value={exh.exhibition_id}>{exh.name}{exh.is_active ? ' (Active)' : ''}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">Name <span className="text-red-400">*</span></label>
              <input type="text" value={formData.primary_visitor_name} onChange={e => set('primary_visitor_name', e.target.value)} className={cls} placeholder="John Doe" required />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">Company <span className="text-red-400">*</span></label>
              <input type="text" value={formData.company_name} onChange={e => set('company_name', e.target.value)} className={cls} placeholder="ABC Corp" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">Phone <span className="text-red-400">*</span></label>
              <input
                type="tel"
                value={formData.primary_visitor_phone}
                onChange={e => set('primary_visitor_phone', e.target.value)}
                onBlur={e => {
                  const digits = e.target.value.replace(/\D/g, '');
                  if (digits.length === 10) set('primary_visitor_phone', `+91${digits}`);
                }}
                className={cls}
                placeholder="+91 98765 43210"
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">Email</label>
              <input type="email" value={formData.primary_visitor_email} onChange={e => set('primary_visitor_email', e.target.value)} className={cls} placeholder="john@example.com" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 block">Designation</label>
            <input type="text" value={formData.primary_visitor_designation} onChange={e => set('primary_visitor_designation', e.target.value)} className={cls} placeholder="Manager, CEO…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">Segment</label>
              <select value={formData.segment} onChange={e => set('segment', e.target.value)} className={cls}>
                <option value="decision_maker">Decision Maker</option>
                <option value="influencer">Influencer</option>
                <option value="researcher">Researcher</option>
                <option value="general">General</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">Priority</label>
              <select value={formData.priority} onChange={e => set('priority', e.target.value)} className={cls}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 block">Discussion Summary</label>
            <textarea value={formData.discussion_summary} onChange={e => set('discussion_summary', e.target.value)} className={cls} rows={3} placeholder="What was discussed…" />
          </div>
        </form>

        <div className="flex gap-2 px-6 py-4 border-t border-slate-100">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button className="flex-1" onClick={() => handleSubmit()} disabled={isSubmitting}>
            {isSubmitting
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Creating…</>
              : <><Plus className="w-3.5 h-3.5 mr-1.5" />Create Lead</>}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
