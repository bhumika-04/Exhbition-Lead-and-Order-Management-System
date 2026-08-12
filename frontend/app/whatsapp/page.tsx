'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import {
  MessageSquare, Loader2, Send, AlertTriangle, PhoneOff, ChevronRight,
} from 'lucide-react';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';
import PageHeader from '@/components/PageHeader';
import { EmptyState } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const TOUCHPOINT_LABELS: Record<string, string> = {
  welcome: 'Welcome',
  order_confirmation: 'Order confirmation',
  testimonial: 'Testimonial',
  showroom_invite: 'Showroom invite',
};

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
}

const rowKey = (i: Issue) => `${i.lead_id}-${i.order_id ?? 0}-${i.touchpoint}`;

export default function WhatsAppIssuesPage() {
  const router = useRouter();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [resendingAll, setResendingAll] = useState(false);
  const [allProgress, setAllProgress] = useState<{ done: number; total: number } | null>(null);
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
  // to add one, not another attempt that will just skip the same way.
  const resendable = issues.filter(i => !!i.recipient);

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
        actions={resendable.length > 0 ? (
          <Button size="sm" disabled={resendingAll} onClick={resendAll} className="gap-1.5 h-9 text-xs">
            {resendingAll
              ? <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {allProgress ? `${allProgress.done}/${allProgress.total}` : 'Resending…'}
                </>
              : <><Send className="w-3.5 h-3.5" /> Resend all ({resendable.length})</>}
          </Button>
        ) : undefined}
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
            {issues.map(issue => {
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
                      {issue.recipient
                        ? `${issue.recipient} · ${issue.error_message || issue.status_code}`
                        : 'No phone number on file'}
                      {' · '}
                      <span suppressHydrationWarning>
                        {formatDistanceToNow(new Date(issue.created_at), { addSuffix: true })}
                      </span>
                    </p>
                  </button>

                  {issue.recipient ? (
                    <Button
                      size="sm" variant="outline" disabled={busy}
                      onClick={() => resendOne(issue)}
                      className="h-8 gap-1.5 text-xs shrink-0"
                    >
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      Resend
                    </Button>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0" title="Add a phone number on the lead first">
                      <PhoneOff className="w-3.5 h-3.5" />
                    </span>
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
