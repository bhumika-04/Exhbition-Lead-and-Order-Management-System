'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { isAuthenticated, hasPermission } from '@/lib/auth';
import type { Lead, SilverCouponAgentSummary, SilverCouponAgentDetail } from '@/lib/types';
import {
  Search, X, Loader2, Award, ChevronRight, Building2, User,
  CheckSquare, Square, Users as UsersIcon, Phone, FileText, Ticket,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { money, silverCouponsFor } from '@/lib/orders';
import PageHeader from '@/components/PageHeader';
import { formatDistanceToNow } from 'date-fns';

type Tab = 'issue' | 'agents';

export default function SilverCouponsPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>('issue');

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated()) { router.push('/auth/login'); return; }
    if (!hasPermission('manage_orders')) { router.replace('/access-denied?from=/silver-coupons'); return; }
  }, [mounted, router]);

  if (!mounted) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/50" />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-background">
      <PageHeader
        icon={Award}
        title="Silver Coupons"
        subtitle={tab === 'issue'
          ? "Select a customer's orders, confirm the agent, hand over the coupon"
          : 'Agents and the customers attributed to them'}
        filters={
          <div className="flex items-center gap-1 bg-secondary/60 rounded-lg p-1">
            <button
              onClick={() => setTab('issue')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                tab === 'issue' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Issue
            </button>
            <button
              onClick={() => setTab('agents')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                tab === 'agents' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Agents
            </button>
          </div>
        }
      />

      {tab === 'issue' ? <IssueTab /> : <AgentsTab />}
    </div>
  );
}

/* ── Issue tab: search, multi-select customers, confirm to an agent ──────── */

function IssueTab() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    api.getLeads({ limit: 5000 })
      .then(({ leads: data }) => setLeads(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Anyone with an SO on file — not just whoever matches a typed search —
  // sorted alphabetically so the list is browsable on its own.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const withOrders = leads.filter(l => (l.order_value ?? 0) > 0);
    const filtered = q
      ? withOrders.filter(l =>
          (l.primary_visitor_name || '').toLowerCase().includes(q) ||
          (l.company_name || '').toLowerCase().includes(q) ||
          (l.primary_visitor_phone || '').includes(q))
      : withOrders;
    return [...filtered].sort((a, b) =>
      (a.primary_visitor_name || a.company_name || '').localeCompare(b.primary_visitor_name || b.company_name || ''));
  }, [leads, query]);

  const selectedLeads = useMemo(
    () => leads.filter(l => selected.has(l.lead_id)),
    [leads, selected],
  );
  const combinedValue = selectedLeads.reduce((sum, l) => sum + (l.order_value ?? 0), 0);

  const toggle = (leadId: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId); else next.add(leadId);
      return next;
    });
  };

  const onConfirmed = () => {
    setSelected(new Set());
    setShowConfirm(false);
  };

  return (
    <>
      {/* ── Search ── */}
      <div className="bg-card border-b border-border px-4 md:px-6 py-2.5 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search customer name, company, or phone…"
            className="pl-9 h-9 bg-secondary/50 border-border focus:bg-card text-sm"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Selected customers, survives changing the search text ── */}
      {selectedLeads.length > 0 && (
        <div className="bg-primary/[0.04] border-b border-primary/15 px-4 md:px-6 py-2.5 shrink-0 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {selectedLeads.map(l => (
              <span key={l.lead_id} className="inline-flex items-center gap-1.5 bg-card border border-border rounded-lg pl-2.5 pr-1 py-1 text-[11px]">
                {l.primary_visitor_name || l.company_name || `Lead #${l.lead_id}`}
                <span className="text-muted-foreground">{money(l.order_value ?? 0)}</span>
                <button onClick={() => toggle(l.lead_id)} className="p-0.5 rounded hover:bg-secondary">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {selectedLeads.length} customer{selectedLeads.length === 1 ? '' : 's'} · Combined {money(combinedValue)} this batch
            </p>
            <Button size="sm" onClick={() => setShowConfirm(true)} className="h-8 text-xs shrink-0">
              Confirm
            </Button>
          </div>
        </div>
      )}

      {/* ── Results ── */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-3 space-y-2">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground/50" /></div>
        ) : results.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">
            {query ? `No customer matches "${query}".` : 'No customer has an SO on file yet.'}
          </p>
        ) : (
          results.map(lead => {
            const isSelected = selected.has(lead.lead_id);
            const total = lead.order_value ?? 0;
            return (
              <div
                key={lead.lead_id}
                onClick={() => toggle(lead.lead_id)}
                className={`w-full flex items-center gap-3 border rounded-xl px-4 py-3 cursor-pointer transition ${
                  isSelected ? 'border-primary/50 bg-primary/[0.05]' : 'border-border bg-card hover:border-primary/30 hover:bg-secondary/30'
                }`}
              >
                {isSelected
                  ? <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                  : <Square className="w-4 h-4 text-muted-foreground/50 shrink-0" />}
                <span className="w-9 h-9 bg-primary/12 rounded-lg flex items-center justify-center shrink-0">
                  {lead.company_name ? <Building2 className="w-4 h-4 text-primary" /> : <User className="w-4 h-4 text-primary" />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {lead.primary_visitor_name || 'Unknown visitor'}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {lead.company_name || '—'}{lead.primary_visitor_phone ? ` · ${lead.primary_visitor_phone}` : ''}
                  </p>
                </div>
                <p className="text-sm font-semibold text-foreground tabular shrink-0">{money(total)}</p>
                <button
                  onClick={e => { e.stopPropagation(); router.push(`/leads/${lead.lead_id}`); }}
                  className="p-1 rounded hover:bg-secondary text-muted-foreground shrink-0"
                  title="Open customer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {showConfirm && (
        <ConfirmDialog
          leadIds={selectedLeads.map(l => l.lead_id)}
          combinedValue={combinedValue}
          onClose={() => setShowConfirm(false)}
          onConfirmed={onConfirmed}
        />
      )}
    </>
  );
}

function ConfirmDialog({ leadIds, combinedValue, onClose, onConfirmed }: {
  leadIds: number[]; combinedValue: number;
  onClose: () => void; onConfirmed: () => void;
}) {
  const [agents, setAgents] = useState<SilverCouponAgentSummary[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [mode, setMode] = useState<'pick' | 'new'>('pick');
  const [selectedAgent, setSelectedAgent] = useState<SilverCouponAgentSummary | null>(null);
  const [agentSearch, setAgentSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [coupons, setCoupons] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getSilverCouponAgents()
      .then(list => { setAgents(list); setMode(list.length > 0 ? 'pick' : 'new'); })
      .catch(() => setMode('new'))
      .finally(() => setLoadingAgents(false));
  }, []);

  // The agent's own running total tops up with this batch — only the NEW
  // coupons that crosses into are owed now, not the batch's value alone.
  // Mirrors AdvanceCalculator.SilverCouponsFor server-side.
  const priorValue = selectedAgent?.total_order_value ?? 0;
  const priorCoupons = selectedAgent?.total_coupons ?? 0;
  const grandTotal = priorValue + combinedValue;
  const totalOwed = silverCouponsFor(grandTotal);
  const newlyOwed = Math.max(0, totalOwed - priorCoupons);

  useEffect(() => {
    setCoupons(Array.from({ length: newlyOwed }, () => ''));
  }, [newlyOwed, selectedAgent?.agent_id, mode]);

  const filteredAgents = agents.filter(a => {
    const q = agentSearch.trim().toLowerCase();
    if (!q) return true;
    return a.name.toLowerCase().includes(q) || a.phone.includes(q);
  });

  const agentName = selectedAgent ? selectedAgent.name : newName;
  const agentPhone = selectedAgent ? selectedAgent.phone : newPhone;

  const submit = async () => {
    if (!agentName.trim()) { toast.error('Enter the agent name'); return; }
    if (!agentPhone.trim()) { toast.error('Enter the agent number'); return; }
    if (coupons.some(c => !c.trim())) { toast.error('Enter every coupon number'); return; }

    setBusy(true);
    try {
      const result = await api.createSilverCouponAllocation(
        agentName.trim(), agentPhone.trim(), leadIds, coupons.map(c => c.trim()),
      );
      toast.success(
        result.coupon_numbers.length > 0
          ? `${result.coupon_numbers.length} new coupon${result.coupon_numbers.length === 1 ? '' : 's'} issued to ${result.agent_name}`
          : `Tracked against ${result.agent_name} — no new coupon yet`
      );
      onConfirmed();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not save this');
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue Silver Coupon</DialogTitle>
          <DialogDescription>
            {leadIds.length} customer{leadIds.length === 1 ? '' : 's'} · This batch {money(combinedValue)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* ── Agent ── */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-foreground">Agent</label>
              {agents.length > 0 && (
                <button
                  onClick={() => { setMode(mode === 'pick' ? 'new' : 'pick'); setSelectedAgent(null); }}
                  className="text-[11px] text-primary hover:underline"
                >
                  {mode === 'pick' ? '+ New agent' : '← Choose existing agent'}
                </button>
              )}
            </div>

            {mode === 'pick' ? (
              selectedAgent ? (
                <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/[0.04] px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{selectedAgent.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {selectedAgent.phone} · already {money(selectedAgent.total_order_value)} tracked · {selectedAgent.total_coupons} coupon{selectedAgent.total_coupons === 1 ? '' : 's'} so far
                    </p>
                  </div>
                  <button onClick={() => setSelectedAgent(null)} className="p-1 rounded hover:bg-secondary text-muted-foreground shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Input
                    value={agentSearch}
                    onChange={e => setAgentSearch(e.target.value)}
                    placeholder="Search agent by name or number…"
                    className="h-9 text-sm"
                  />
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                    {loadingAgents ? (
                      <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground/50" /></div>
                    ) : filteredAgents.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-3">No agent matches — use "+ New agent" above.</p>
                    ) : (
                      filteredAgents.map(a => (
                        <button
                          key={a.agent_id}
                          onClick={() => setSelectedAgent(a)}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-secondary/40 transition"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{a.name}</p>
                            <p className="text-[11px] text-muted-foreground">{a.phone}</p>
                          </div>
                          <p className="text-[11px] text-muted-foreground shrink-0">{money(a.total_order_value)}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )
            ) : (
              <div className="space-y-1.5">
                <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Agent name, e.g. Ramesh Kumar" className="h-9 text-sm" />
                <Input value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="Agent number, e.g. 98765 43210" className="h-9 text-sm" />
              </div>
            )}
          </div>

          {/* ── Running total preview ── */}
          {(selectedAgent || mode === 'new') && (
            <p className="text-[11px] text-muted-foreground bg-secondary/40 rounded-lg px-3 py-2">
              Running total after this: {money(grandTotal)} ·{' '}
              <span className={newlyOwed > 0 ? 'text-primary font-medium' : ''}>
                {newlyOwed > 0 ? `${newlyOwed} new coupon${newlyOwed === 1 ? '' : 's'} owed` : 'no new coupon yet — still under the next ₹1L'}
              </span>
            </p>
          )}

          {coupons.length > 0 && (
            <div className="space-y-1.5">
              {coupons.map((val, i) => (
                <div key={i}>
                  <label className="text-xs font-medium text-foreground">Coupon {i + 1}</label>
                  <Input
                    value={val}
                    onChange={e => setCoupons(c => c.map((x, j) => (j === i ? e.target.value : x)))}
                    placeholder="e.g. S-101"
                    className="mt-1 h-9 text-sm"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || (!selectedAgent && mode === 'pick')}>
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Agents tab: list of agents, click through to their customers ────────── */

function AgentsTab() {
  const [agents, setAgents] = useState<SilverCouponAgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    api.getSilverCouponAgents().then(setAgents).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex-1 flex justify-center items-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground/50" /></div>;
  }

  if (agents.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6">
        <UsersIcon className="w-8 h-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No agents yet — issue a coupon from the Issue tab to add one.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-6 py-3 space-y-2">
      {agents.map(agent => {
        const isOpen = expanded === agent.agent_id;
        return (
          <div key={agent.agent_id} className="bg-card border border-border rounded-xl overflow-hidden">
            <button
              onClick={() => setExpanded(isOpen ? null : agent.agent_id)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary/30 transition"
            >
              <span className="w-9 h-9 bg-primary/12 rounded-lg flex items-center justify-center shrink-0">
                <UsersIcon className="w-4 h-4 text-primary" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{agent.name}</p>
                <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                  <Phone className="w-3 h-3" /> {agent.phone} · {agent.customer_count} customer{agent.customer_count === 1 ? '' : 's'}
                  {agent.last_allocation_at && ` · last ${formatDistanceToNow(new Date(agent.last_allocation_at), { addSuffix: true })}`}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-foreground tabular">{money(agent.total_order_value)}</p>
                <div className="flex items-center justify-end gap-1 text-[11px] text-primary font-medium">
                  <Award className="w-3 h-3" /> {agent.total_coupons} coupon{agent.total_coupons === 1 ? '' : 's'}
                </div>
              </div>
              <ChevronRight className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
            </button>

            {isOpen && <AgentCustomers agentId={agent.agent_id} />}
          </div>
        );
      })}
    </div>
  );
}

function AgentCustomers({ agentId }: { agentId: number }) {
  const router = useRouter();
  const [detail, setDetail] = useState<SilverCouponAgentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getSilverCouponAgentDetail(agentId).then(setDetail).catch(() => setDetail(null)).finally(() => setLoading(false));
  }, [agentId]);

  if (loading) {
    return <div className="border-t border-border px-4 py-4 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground/50" /></div>;
  }

  if (!detail || detail.customers.length === 0) {
    return <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">No customers found for this agent.</p>;
  }

  return (
    <div className="border-t border-border divide-y divide-border">
      {detail.customers.map(c => (
        <button
          key={`${c.allocation_id}-${c.lead_id}`}
          onClick={() => router.push(`/leads/${c.lead_id}`)}
          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary/30 transition"
        >
          <span className="w-8 h-8 bg-primary/12 rounded-lg flex items-center justify-center shrink-0">
            {c.company_name ? <Building2 className="w-3.5 h-3.5 text-primary" /> : <User className="w-3.5 h-3.5 text-primary" />}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {c.primary_visitor_name || 'Unknown visitor'}
            </p>
            <p className="text-[11px] text-muted-foreground truncate">
              {c.company_name || '—'}{c.primary_visitor_phone ? ` · ${c.primary_visitor_phone}` : ''}
            </p>
            <div className="flex flex-wrap gap-1 mt-1">
              {c.order_numbers.length > 0 ? c.order_numbers.map(so => (
                <span key={so} className="inline-flex items-center gap-1 bg-secondary text-foreground rounded px-1.5 py-0.5 text-[10px]">
                  <FileText className="w-2.5 h-2.5" /> {so}
                </span>
              )) : (
                <span className="text-[10px] text-muted-foreground">No SO recorded</span>
              )}
              {c.coupon_numbers.map(n => (
                <span key={n} className="inline-flex items-center gap-1 bg-primary/10 text-primary rounded px-1.5 py-0.5 text-[10px]">
                  <Ticket className="w-2.5 h-2.5" /> {n}
                </span>
              ))}
            </div>
          </div>
          <p className="text-sm font-semibold text-foreground tabular shrink-0">{money(c.lead_value_at_allocation)}</p>
        </button>
      ))}
    </div>
  );
}
