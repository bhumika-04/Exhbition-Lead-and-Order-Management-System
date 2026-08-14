'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import * as XLSX from 'xlsx';
import {
  MessageSquare, Loader2, Send, AlertTriangle, PhoneOff, ChevronRight, X, RefreshCw, Pencil,
  FileDown,
} from 'lucide-react';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';
import { normaliseIndianPhone, PHONE_ERROR } from '@/lib/phone';
import { TOUCHPOINT_LABELS, STATUS_LABELS } from '@/lib/whatsapp';
import PageHeader from '@/components/PageHeader';
import { EmptyState } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface Issue {
  lead_id: number;
  lead_name: string | null;
  company_name: string | null;
  order_id: number | null;
  order_number: string | null;
  touchpoint: string;
  recipient: string | null;
  status_code: string;
  error_message: string | null;
  created_at: string;
  // The lead's phone as it stands now — recipient above is a historical
  // snapshot from the failed attempt, which lags behind a since-made edit
  // and is null for "malformed" the same way it's null for "never set".
  lead_current_phone: string | null;
}

const rowKey = (i: Issue) => `${i.lead_id}-${i.order_id ?? 0}-${i.touchpoint}`;

export default function WhatsAppIssuesPage() {
  const router = useRouter();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [resendingAll, setResendingAll] = useState(false);
  const [allProgress, setAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const CHUNK = 10;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getWhatsAppIssues();
      setIssues(res.issues);
    } catch {
      toast.error('Could not load WhatsApp delivery issues');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/auth/login'); return; }
    load();
  }, [load, router]);

  // Nothing to resend for a lead with no phone at all — that needs a human
  // to add one, not another attempt that will just skip the same way. Based
  // on the lead's CURRENT phone, not the historical logged recipient, so an
  // edit made since the failure is picked up without waiting for a resend
  // to re-log it.
  const resendable = issues.filter(i => !!i.lead_current_phone);

  const sortedIssues = [...issues].sort((a, b) =>
    (a.lead_name || a.company_name || '').localeCompare(b.lead_name || b.company_name || ''));

  const exportExcel = () => {
    const rows = [
      ['LEAD NAME', 'COMPANY', 'PHONE', 'TOUCHPOINT', 'ORDER', 'ISSUE', 'STATUS', 'WHEN'],
      ...sortedIssues.map(i => [
        i.lead_name || 'Unknown',
        i.company_name || '',
        i.lead_current_phone || 'No phone number on file',
        TOUCHPOINT_LABELS[i.touchpoint] || i.touchpoint,
        i.order_number || '',
        i.error_message || (i.lead_current_phone ? '' : 'No phone number on file'),
        STATUS_LABELS[i.status_code] || i.status_code,
        new Date(i.created_at).toLocaleString('en-IN'),
      ]),
    ];

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = [
      { wch: 22 }, { wch: 20 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 34 }, { wch: 10 }, { wch: 18 },
    ];

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'WhatsApp Issues');

    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(book, `whatsapp-delivery-issues-${stamp}.xlsx`);
  };

  const resendOne = async (issue: Issue, { silent = false } = {}) => {
    const key = rowKey(issue);
    setBusyKeys(s => new Set(s).add(key));
    try {
      const res = await api.resendWhatsApp(issue.lead_id, issue.touchpoint, issue.order_id);
      if (!silent) {
        if (res.sent) toast.success('Resent');
        else toast.error(res.error || 'Still could not send it');
      }
      return res.sent;
    } catch (err: any) {
      if (!silent) toast.error(err.response?.data?.error || 'Could not resend');
      return false;
    } finally {
      setBusyKeys(s => { const next = new Set(s); next.delete(key); return next; });
    }
  };

  const resendAll = async () => {
    if (resendable.length === 0 || resendingAll) return;
    setResendingAll(true);
    setAllProgress({ done: 0, total: resendable.length });
    let fixed = 0;
    try {
      for (let i = 0; i < resendable.length; i += CHUNK) {
        const chunk = resendable.slice(i, i + CHUNK);
        const results = await Promise.all(chunk.map(issue => resendOne(issue, { silent: true })));
        fixed += results.filter(Boolean).length;
        setAllProgress({ done: Math.min(i + CHUNK, resendable.length), total: resendable.length });
      }
    } finally {
      toast.success(
        `${fixed} sent` + (fixed < resendable.length ? ` — ${resendable.length - fixed} still didn't go through` : '')
      );
      setResendingAll(false);
      setAllProgress(null);
      await load();
    }
  };

  /**
   * Fixing the number fixes every touchpoint that failed for the same
   * reason — resends all of this lead's outstanding issues, not just the
   * row that was edited, so a welcome and an order confirmation both stuck
   * on a bad number go out together.
   */
  const saveNumberAndResendAll = async (issue: Issue) => {
    const key = rowKey(issue);
    const normalised = normaliseIndianPhone(editValue);
    if (!normalised) { toast.error(PHONE_ERROR); return; }

    setBusyKeys(s => new Set(s).add(key));
    try {
      await api.updateLead(issue.lead_id, { primary_visitor_phone: normalised } as any);

      const sameLead = issues.filter(i => i.lead_id === issue.lead_id);
      const results = await Promise.all(sameLead.map(i => resendOne(i, { silent: true })));
      const sentCount = results.filter(Boolean).length;

      toast.success(
        sentCount === sameLead.length
          ? `Number saved — ${sentCount} message${sentCount === 1 ? '' : 's'} sent`
          : `Number saved — ${sentCount}/${sameLead.length} sent`
      );
      setEditingKey(null);
      setEditValue('');
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not save that number');
    } finally {
      setBusyKeys(s => { const next = new Set(s); next.delete(key); return next; });
    }
  };

  return (
    <>
      <PageHeader
        icon={MessageSquare}
        title="WhatsApp Delivery"
        subtitle={
          loading ? 'Checking…'
            : issues.length === 0 ? 'Every touchpoint went through'
            : `${issues.length} touchpoint${issues.length === 1 ? '' : 's'} did not send`
        }
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={loading} onClick={load} className="gap-1.5 h-9 text-xs" title="Reload — picks up a number just edited on the lead page">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            {issues.length > 0 && (
              <Button size="sm" variant="outline" onClick={exportExcel} className="gap-1.5 h-9 text-xs">
                <FileDown className="w-3.5 h-3.5" /> Export Excel
              </Button>
            )}
            {resendable.length > 0 && (
              <Button size="sm" disabled={resendingAll} onClick={resendAll} className="gap-1.5 h-9 text-xs">
                {resendingAll
                  ? <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {allProgress ? `${allProgress.done}/${allProgress.total}` : 'Resending…'}
                    </>
                  : <><Send className="w-3.5 h-3.5" /> Resend all ({resendable.length})</>}
              </Button>
            )}
          </div>
        }
      />

      <div className="px-4 md:px-6 py-4 space-y-3 max-w-4xl mx-auto">
        {/* "sent" here only means Interakt accepted the request at the time —
            there is no webhook telling this app what happened after. This
            page can only ever show what Interakt's own API refused or what
            never had a real phone number to try. */}
        <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-muted-foreground shrink-0 mt-px" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            This lists what Interakt's API rejected or skipped, not what WhatsApp actually delivered —
            there is no delivery-status webhook wired up, so a message a customer says they never got,
            despite showing "sent" here, has to be resent from that customer's own report, not from this list.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground/50" /></div>
        ) : issues.length === 0 ? (
          <EmptyState icon={MessageSquare} title="Nothing outstanding"
                      hint="Every welcome, order confirmation, testimonial and showroom invite sent so far was accepted by Interakt." />
        ) : (
          <div className="space-y-2">
            {sortedIssues.map(issue => {
              const key = rowKey(issue);
              const busy = busyKeys.has(key);
              return (
                <div key={key}
                     className="rounded-lg border border-border bg-card px-3.5 py-2.5 flex items-center gap-3">
                  <span className={`w-[3px] self-stretch rounded-full shrink-0 ${
                    issue.status_code === 'failed' ? 'bg-destructive' : 'bg-warning'
                  }`} />

                  <button
                    onClick={() => router.push(`/leads/${issue.lead_id}`)}
                    className="flex-1 min-w-0 text-left group"
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                        {issue.lead_name || 'Unknown'}
                      </span>
                      {issue.company_name && (
                        <span className="text-xs text-muted-foreground truncate">· {issue.company_name}</span>
                      )}
                      <Badge variant={issue.status_code === 'failed' ? 'danger' : 'warning'}>
                        {TOUCHPOINT_LABELS[issue.touchpoint] || issue.touchpoint}
                      </Badge>
                      {issue.order_number && (
                        <span className="text-[10px] font-mono text-muted-foreground">{issue.order_number}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {issue.lead_current_phone
                        ? `${issue.lead_current_phone} · ${issue.error_message || issue.status_code}`
                        : 'No phone number on file'}
                      {' · '}
                      <span suppressHydrationWarning>
                        {formatDistanceToNow(new Date(issue.created_at), { addSuffix: true })}
                      </span>
                    </p>
                  </button>

                  {editingKey === key ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <input
                        autoFocus
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveNumberAndResendAll(issue);
                          if (e.key === 'Escape') { setEditingKey(null); setEditValue(''); }
                        }}
                        placeholder="10-digit number"
                        inputMode="tel"
                        className="h-8 w-28 px-2 rounded-md border border-border bg-card text-xs"
                      />
                      <Button
                        size="sm" disabled={busy}
                        onClick={() => saveNumberAndResendAll(issue)}
                        className="h-8 px-2 text-xs"
                      >
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      </Button>
                      <button
                        onClick={() => { setEditingKey(null); setEditValue(''); }}
                        className="p-1.5 rounded hover:bg-secondary text-muted-foreground"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 shrink-0">
                      {issue.lead_current_phone && (
                        <Button
                          size="sm" variant="outline" disabled={busy}
                          onClick={() => resendOne(issue)}
                          className="h-8 gap-1.5 text-xs"
                        >
                          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          Resend
                        </Button>
                      )}
                      <Button
                        size="sm" variant="outline"
                        onClick={() => {
                          setEditingKey(key);
                          setEditValue(issue.lead_current_phone
                            ? normaliseIndianPhone(issue.lead_current_phone) ?? issue.lead_current_phone
                            : '');
                        }}
                        className="h-8 gap-1.5 text-xs"
                        title={issue.lead_current_phone ? 'Edit this number' : 'Add a phone number'}
                      >
                        {issue.lead_current_phone ? <Pencil className="w-3.5 h-3.5" /> : <PhoneOff className="w-3.5 h-3.5" />}
                        {issue.lead_current_phone ? '' : 'Add number'}
                      </Button>
                    </div>
                  )}
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
