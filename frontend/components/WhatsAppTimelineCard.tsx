'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { MessageSquare, Loader2, CheckCircle2, XCircle, PhoneOff } from 'lucide-react';
import { api } from '@/lib/api';
import { TOUCHPOINT_LABELS, STATUS_LABELS } from '@/lib/whatsapp';
import type { WhatsAppHistoryItem } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';

/** Every WhatsApp attempt for this lead — welcome, order confirmation, etc — newest first. */
export default function WhatsAppTimelineCard({ leadId }: { leadId: number }) {
  const [items, setItems] = useState<WhatsAppHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { history } = await api.getWhatsAppHistory(leadId);
      setItems(history);
    } catch {
      // Quiet — a lead with nothing sent yet is normal.
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <Card className="shadow-sm border-border">
        <CardContent className="px-5 py-6 flex justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/50" />
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) return null;

  return (
    <Card className="shadow-sm border-border">
      <CardContent className="px-5 py-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 bg-primary/12 rounded-lg flex items-center justify-center shrink-0">
            <MessageSquare className="w-4 h-4 text-primary" />
          </span>
          <p className="text-sm font-semibold text-foreground flex-1">WhatsApp</p>
        </div>

        <div className="space-y-2.5">
          {items.map((item, i) => {
            const ok = item.status_code === 'sent' || item.status_code === 'delivered' || item.status_code === 'read';
            const noPhone = !item.recipient;
            return (
              <div key={i} className="flex items-start gap-2.5">
                {ok
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
                  : noPhone
                    ? <PhoneOff className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">
                    {TOUCHPOINT_LABELS[item.touchpoint] || item.touchpoint}
                    {item.order_number && <span className="text-muted-foreground font-normal"> · {item.order_number}</span>}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {STATUS_LABELS[item.status_code] || item.status_code}
                    {item.recipient ? ` · ${item.recipient}` : ' · no phone number'}
                    {!ok && item.error_message ? ` · ${item.error_message}` : ''}
                    {' · '}
                    <span suppressHydrationWarning>
                      {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                    </span>
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
